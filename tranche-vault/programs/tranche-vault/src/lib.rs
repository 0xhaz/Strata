//! tranche-vault — a pooled senior/junior risk-tranching vault for the Tranche Agent.
//!
//! Multiple users deposit USDC into a SENIOR (fixed-ish coupon, first-protected) or a
//! JUNIOR (levered residual, first-loss) tranche and receive SPL share tokens. The agent
//! operator (the pool `authority`) runs the delta-neutral CLMM+perp strategy OFF-chain and
//! reports each period's realized PnL via `settle`; the vault applies the senior coupon and
//! the junior buffer flow on-chain, so the risk split is verifiable.
//!
//! ORIGINAL CODE. The senior-coupon / junior-first-loss *mechanism* is conceptually inspired
//! by BarnBridge SmartAlpha, but NO BarnBridge Solidity is lifted — this is fresh Rust with a
//! share-price vault model, a different settlement design, and SPL tranche tokens.
//!
//! Solvency invariant: vault USDC balance == senior_assets + junior_assets at all times.
//! Coupon is an internal senior<-junior reallocation (net zero); only realized PnL moves USDC
//! in/out of the vault during settle, so the vault always fully backs both tranches' NAV.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("fmnzmMUcR2nojDq1TrSywozC7FUTnpJTMb6fTfoUPng");

const SECONDS_PER_YEAR: u128 = 31_536_000;
const BPS_DENOM: u128 = 10_000;
const COUPON_BPS_MAX: u16 = 1_200; // 12% hard cap (matches the off-chain hc-curve)

pub const SENIOR: u8 = 0;
pub const JUNIOR: u8 = 1;

#[program]
pub mod tranche_vault {
    use super::*;

    /// Create a pool: USDC custody vault + senior & junior share mints, all PDA-owned.
    pub fn initialize_pool(ctx: Context<InitializePool>, coupon_bps: u16) -> Result<()> {
        require!(coupon_bps <= COUPON_BPS_MAX, VaultError::CouponTooHigh);
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.senior_mint = ctx.accounts.senior_mint.key();
        pool.junior_mint = ctx.accounts.junior_mint.key();
        pool.coupon_bps = coupon_bps;
        pool.senior_assets = 0;
        pool.junior_assets = 0;
        pool.senior_shares = 0;
        pool.junior_shares = 0;
        pool.last_settle_ts = Clock::get()?.unix_timestamp;
        pool.paused = false;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    /// Authority-only circuit breaker. Pauses deposits + settle; withdrawals stay open
    /// so depositors can always exit.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.pool.paused = paused;
        emit!(PausedEvent { paused });
        Ok(())
    }

    /// Deposit `amount` USDC into a tranche; mint shares at the current share price.
    pub fn deposit(ctx: Context<Deposit>, tranche: u8, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let pool = &mut ctx.accounts.pool;
        require!(!pool.paused, VaultError::Paused);
        check_tranche_mint(pool, tranche, &ctx.accounts.tranche_mint.key())?;

        let (assets, shares) = pool.tranche_state(tranche);
        // Standard vault math: shares minted keep share_price = assets/shares constant.
        // Bootstrap 1:1 when the tranche is empty.
        let minted: u64 = if shares == 0 || assets == 0 {
            amount
        } else {
            u64::try_from((amount as u128) * (shares as u128) / (assets as u128))
                .map_err(|_| VaultError::MathOverflow)?
        };
        require!(minted > 0, VaultError::ZeroShares);

        // Pull USDC user -> vault.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Mint tranche shares to the user (pool PDA is the mint authority).
        let seeds: &[&[u8]] = &[b"pool", pool.authority.as_ref(), &[pool.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.tranche_mint.to_account_info(),
                    to: ctx.accounts.user_shares.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[seeds],
            ),
            minted,
        )?;

        pool.add_assets(tranche, amount, minted)?;
        emit!(DepositEvent { tranche, amount, shares: minted, user: ctx.accounts.user.key() });
        Ok(())
    }

    /// Authority-only: report the period's realized strategy PnL (USDC, signed) and apply
    /// the senior coupon + junior buffer flow. Realized PnL is moved in/out of the vault so
    /// the solvency invariant holds.
    pub fn settle(ctx: Context<Settle>, realized_pnl: i64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(!pool.paused, VaultError::Paused);
        let now = Clock::get()?.unix_timestamp;
        let dt = (now - pool.last_settle_ts).max(0) as u128;

        // Coupon owed to senior over the elapsed period.
        let coupon: u64 = u64::try_from(
            (pool.senior_assets as u128) * (pool.coupon_bps as u128) * dt
                / (BPS_DENOM * SECONDS_PER_YEAR),
        )
        .map_err(|_| VaultError::MathOverflow)?;

        // Back the realized PnL with actual USDC: in if positive, out if negative.
        let seeds: &[&[u8]] = &[b"pool", pool.authority.as_ref(), &[pool.bump]];
        if realized_pnl > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.authority_usdc.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                ),
                realized_pnl as u64,
            )?;
        } else if realized_pnl < 0 {
            let out = (-(realized_pnl as i128)) as u64;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.authority_usdc.to_account_info(),
                        authority: pool.to_account_info(),
                    },
                    &[seeds],
                ),
                out,
            )?;
        }

        // Apply, preserving the solvency invariant senior+junior == old + realized_pnl.
        // A tranche's residual only accrues to it if it has holders; otherwise it folds into
        // the other tranche (closes the "assets with no shares" orphan case). The coupon is
        // moot when there are no senior holders.
        let has_junior = pool.junior_shares > 0;
        let coupon = if pool.senior_shares > 0 { coupon } else { 0 };
        let junior_change: i128 = (realized_pnl as i128) - (coupon as i128);
        let junior_new: i128 = (pool.junior_assets as i128) + junior_change;

        let mut breached = false;
        if has_junior && junior_new >= 0 {
            // Junior covers the coupon and keeps the rest; senior gets its full coupon.
            pool.senior_assets = pool.senior_assets.checked_add(coupon).ok_or(VaultError::MathOverflow)?;
            pool.junior_assets = junior_new as u64;
        } else {
            // Junior wiped by a loss (breach) OR no junior holders to take the residual:
            // senior takes the remainder. senior_after = senior + junior + realized_pnl,
            // which exactly preserves solvency.
            let senior_after: i128 =
                (pool.senior_assets as i128) + (pool.junior_assets as i128) + (realized_pnl as i128);
            require!(senior_after >= 0, VaultError::Insolvent); // loss > entire pool — impossible if backed
            pool.senior_assets = senior_after as u64;
            pool.junior_assets = 0;
            breached = has_junior; // a true buffer breach only if junior holders existed
        }

        pool.last_settle_ts = now;
        emit!(SettleEvent {
            realized_pnl,
            coupon,
            senior_assets: pool.senior_assets,
            junior_assets: pool.junior_assets,
            buffer_breached: breached,
        });
        Ok(())
    }

    /// Redeem `shares` of a tranche for USDC at the current share price.
    pub fn withdraw(ctx: Context<Withdraw>, tranche: u8, shares: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroShares);
        let pool = &mut ctx.accounts.pool;
        check_tranche_mint(pool, tranche, &ctx.accounts.tranche_mint.key())?;

        let (assets, total_shares) = pool.tranche_state(tranche);
        require!(shares <= total_shares, VaultError::InsufficientShares);
        let amount_out: u64 = u64::try_from((shares as u128) * (assets as u128) / (total_shares as u128))
            .map_err(|_| VaultError::MathOverflow)?;
        // Defensive: never pay out more than the vault holds (the invariant guarantees this).
        require!(amount_out <= ctx.accounts.vault.amount, VaultError::InsufficientVault);

        // Burn the user's shares.
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.tranche_mint.to_account_info(),
                    from: ctx.accounts.user_shares.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares,
        )?;

        // Pay out USDC vault -> user (pool PDA signs).
        let seeds: &[&[u8]] = &[b"pool", pool.authority.as_ref(), &[pool.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_usdc.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[seeds],
            ),
            amount_out,
        )?;

        pool.remove_assets(tranche, amount_out, shares)?;
        emit!(WithdrawEvent { tranche, amount: amount_out, shares, user: ctx.accounts.user.key() });
        Ok(())
    }
}

fn check_tranche_mint(pool: &Pool, tranche: u8, mint: &Pubkey) -> Result<()> {
    let expected = match tranche {
        SENIOR => pool.senior_mint,
        JUNIOR => pool.junior_mint,
        _ => return err!(VaultError::BadTranche),
    };
    require_keys_eq!(*mint, expected, VaultError::WrongMint);
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub senior_mint: Pubkey,
    pub junior_mint: Pubkey,
    pub coupon_bps: u16,
    pub senior_assets: u64,
    pub junior_assets: u64,
    pub senior_shares: u64,
    pub junior_shares: u64,
    pub last_settle_ts: i64,
    pub paused: bool,
    pub bump: u8,
}

impl Pool {
    fn tranche_state(&self, tranche: u8) -> (u64, u64) {
        match tranche {
            SENIOR => (self.senior_assets, self.senior_shares),
            _ => (self.junior_assets, self.junior_shares),
        }
    }
    fn add_assets(&mut self, tranche: u8, amount: u64, shares: u64) -> Result<()> {
        match tranche {
            SENIOR => {
                self.senior_assets = self.senior_assets.checked_add(amount).ok_or(VaultError::MathOverflow)?;
                self.senior_shares = self.senior_shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;
            }
            _ => {
                self.junior_assets = self.junior_assets.checked_add(amount).ok_or(VaultError::MathOverflow)?;
                self.junior_shares = self.junior_shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;
            }
        }
        Ok(())
    }
    fn remove_assets(&mut self, tranche: u8, amount: u64, shares: u64) -> Result<()> {
        match tranche {
            SENIOR => {
                self.senior_assets = self.senior_assets.checked_sub(amount).ok_or(VaultError::MathOverflow)?;
                self.senior_shares = self.senior_shares.checked_sub(shares).ok_or(VaultError::MathOverflow)?;
            }
            _ => {
                self.junior_assets = self.junior_assets.checked_sub(amount).ok_or(VaultError::MathOverflow)?;
                self.junior_shares = self.junior_shares.checked_sub(shares).ok_or(VaultError::MathOverflow)?;
            }
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", authority.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = pool,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        mint::decimals = 6,
        mint::authority = pool,
        seeds = [b"senior", pool.key().as_ref()],
        bump
    )]
    pub senior_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        mint::decimals = 6,
        mint::authority = pool,
        seeds = [b"junior", pool.key().as_ref()],
        bump
    )]
    pub junior_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.authority.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, address = pool.vault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub tranche_mint: Account<'info, Mint>,
    #[account(mut, token::mint = pool.usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::authority = user)]
    pub user_shares: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(address = pool.authority)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.authority.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, address = pool.vault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = pool.usdc_mint, token::authority = authority)]
    pub authority_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(address = pool.authority)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.authority.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.authority.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, address = pool.vault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub tranche_mint: Account<'info, Mint>,
    #[account(mut, token::mint = pool.usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::authority = user)]
    pub user_shares: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct DepositEvent { pub tranche: u8, pub amount: u64, pub shares: u64, pub user: Pubkey }
#[event]
pub struct WithdrawEvent { pub tranche: u8, pub amount: u64, pub shares: u64, pub user: Pubkey }
#[event]
pub struct SettleEvent {
    pub realized_pnl: i64,
    pub coupon: u64,
    pub senior_assets: u64,
    pub junior_assets: u64,
    pub buffer_breached: bool,
}
#[event]
pub struct PausedEvent { pub paused: bool }

#[error_code]
pub enum VaultError {
    #[msg("Coupon exceeds the 12% hard cap")]
    CouponTooHigh,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Computed shares would be zero")]
    ZeroShares,
    #[msg("Invalid tranche id")]
    BadTranche,
    #[msg("Tranche mint does not match the pool")]
    WrongMint,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Pool is paused")]
    Paused,
    #[msg("Loss exceeds the entire pool")]
    Insolvent,
    #[msg("Vault has insufficient balance for this redemption")]
    InsufficientVault,
}
