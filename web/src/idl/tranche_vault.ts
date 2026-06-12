/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tranche_vault.json`.
 */
export type TrancheVault = {
  "address": "fmnzmMUcR2nojDq1TrSywozC7FUTnpJTMb6fTfoUPng",
  "metadata": {
    "name": "trancheVault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "deposit",
      "docs": [
        "Deposit `amount` USDC into a tranche; mint shares at the current share price."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.authority",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "trancheMint",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userShares",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "tranche",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializePool",
      "docs": [
        "Create a pool: USDC custody vault + senior & junior share mints, all PDA-owned."
      ],
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "seniorMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  110,
                  105,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "juniorMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  117,
                  110,
                  105,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "couponBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Authority-only circuit breaker. Pauses deposits + settle; withdrawals stay open",
        "so depositors can always exit."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.authority",
                "account": "pool"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Authority-only: report the period's realized strategy PnL (USDC, signed) and apply",
        "the senior coupon + junior buffer flow. Realized PnL is moved in/out of the vault so",
        "the solvency invariant holds."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.authority",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "authorityUsdc",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "realizedPnl",
          "type": "i64"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Redeem `shares` of a tranche for USDC at the current share price."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.authority",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "trancheMint",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userShares",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "tranche",
          "type": "u8"
        },
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    }
  ],
  "events": [
    {
      "name": "depositEvent",
      "discriminator": [
        120,
        248,
        61,
        83,
        31,
        142,
        107,
        144
      ]
    },
    {
      "name": "pausedEvent",
      "discriminator": [
        43,
        14,
        250,
        236,
        116,
        42,
        177,
        89
      ]
    },
    {
      "name": "settleEvent",
      "discriminator": [
        14,
        166,
        206,
        248,
        35,
        1,
        134,
        48
      ]
    },
    {
      "name": "withdrawEvent",
      "discriminator": [
        22,
        9,
        133,
        26,
        160,
        44,
        71,
        192
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "couponTooHigh",
      "msg": "Coupon exceeds the 12% hard cap"
    },
    {
      "code": 6001,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6002,
      "name": "zeroShares",
      "msg": "Computed shares would be zero"
    },
    {
      "code": 6003,
      "name": "badTranche",
      "msg": "Invalid tranche id"
    },
    {
      "code": 6004,
      "name": "wrongMint",
      "msg": "Tranche mint does not match the pool"
    },
    {
      "code": 6005,
      "name": "insufficientShares",
      "msg": "Insufficient shares"
    },
    {
      "code": 6006,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6007,
      "name": "paused",
      "msg": "Pool is paused"
    },
    {
      "code": 6008,
      "name": "insolvent",
      "msg": "Loss exceeds the entire pool"
    },
    {
      "code": 6009,
      "name": "insufficientVault",
      "msg": "Vault has insufficient balance for this redemption"
    }
  ],
  "types": [
    {
      "name": "depositEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tranche",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "user",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "pausedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "pool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "seniorMint",
            "type": "pubkey"
          },
          {
            "name": "juniorMint",
            "type": "pubkey"
          },
          {
            "name": "couponBps",
            "type": "u16"
          },
          {
            "name": "seniorAssets",
            "type": "u64"
          },
          {
            "name": "juniorAssets",
            "type": "u64"
          },
          {
            "name": "seniorShares",
            "type": "u64"
          },
          {
            "name": "juniorShares",
            "type": "u64"
          },
          {
            "name": "lastSettleTs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "settleEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "realizedPnl",
            "type": "i64"
          },
          {
            "name": "coupon",
            "type": "u64"
          },
          {
            "name": "seniorAssets",
            "type": "u64"
          },
          {
            "name": "juniorAssets",
            "type": "u64"
          },
          {
            "name": "bufferBreached",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "withdrawEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tranche",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "user",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
