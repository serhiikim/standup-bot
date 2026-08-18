# [1.3.0](https://github.com/serhiikim/standup-bot/compare/v1.2.0...v1.3.0) (2026-08-18)


### Bug Fixes

* do not let a failed reaction abort response handling ([32549fc](https://github.com/serhiikim/standup-bot/commit/32549fcd55a1138d79d65d4069ab1b29db8fecde))
* repair the duplicate-standup guard broken by string dates ([48a665f](https://github.com/serhiikim/standup-bot/commit/48a665f1d0bf43c7e88f8b9484634d2a256e50b6))
* resolve the workspace id from the Bolt envelope, not the payload ([737a07e](https://github.com/serhiikim/standup-bot/commit/737a07eb6c95d5dc73c210269698667e2d4af997))
* serialise standup writes so concurrent replies stop erasing each other ([641006f](https://github.com/serhiikim/standup-bot/commit/641006f561c0c7e5982d9e79674307ed5f73e925))
* stop discarding the response counts the completion service computes ([a3a26e0](https://github.com/serhiikim/standup-bot/commit/a3a26e0f3efc806403a9bf7b2d4c68b58f40bf50))
* stop killing the process on Socket Mode reconnect races ([0a6d550](https://github.com/serhiikim/standup-bot/commit/0a6d550bf9e7e8295484545bbbe34bd4dbaf14f6))


### Features

* add a script to recover standup replies stranded in Slack threads ([8a4c803](https://github.com/serhiikim/standup-bot/commit/8a4c8031a616ee39f182affedc3ced61e0f20b07))

# [1.2.0](https://github.com/serhiikim/standup-bot/compare/v1.1.0...v1.2.0) (2026-08-18)


### Bug Fixes

* stop dropping file_share and thread_broadcast standup replies ([04c03a1](https://github.com/serhiikim/standup-bot/commit/04c03a1f6088facbefd2fe7d08083977f5dba403))


### Features

* support a single free-form standup prompt ([6f559c0](https://github.com/serhiikim/standup-bot/commit/6f559c01fc3db6d19fceb5d8f661be7534da5f58))

# [1.1.0](https://github.com/serhiikim/standup-bot/compare/v1.0.2...v1.1.0) (2026-07-10)


### Features

* persist late standup replies instead of dropping them ([00cfc52](https://github.com/serhiikim/standup-bot/commit/00cfc52072d90525b1d4e04488154e13cf48a221))

## [1.0.2](https://github.com/serhiikim/standup-bot/compare/v1.0.1...v1.0.2) (2026-07-10)


### Bug Fixes

* prevent npm ci --omit=dev from failing on missing husky in prepare script ([ea6337f](https://github.com/serhiikim/standup-bot/commit/ea6337f87b1000f4bd448ebc2e91f8af38375082))

## [1.0.1](https://github.com/serhiikim/standup-bot/compare/v1.0.0...v1.0.1) (2026-07-10)


### Bug Fixes

* resolve npm ci lockfile failure in release/test CI jobs ([bb0ccae](https://github.com/serhiikim/standup-bot/commit/bb0ccaea68e527d3f3824ad535dc698f2a0e756d))
