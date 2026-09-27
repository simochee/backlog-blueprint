# Changelog

## [0.2.0](https://github.com/simochee/backlog-blueprint/compare/v0.1.0...v0.2.0) (2026-09-27)


### Features

* ship the JSON Schema in the npm package and point $schema at jsDelivr ([#24](https://github.com/simochee/backlog-blueprint/issues/24)) ([7abb298](https://github.com/simochee/backlog-blueprint/commit/7abb2982d123ef9b7e03a90b1c911d46aa7b2507))
* **web:** add a favicon and an Apple touch icon ([#29](https://github.com/simochee/backlog-blueprint/issues/29)) ([b6ee19d](https://github.com/simochee/backlog-blueprint/commit/b6ee19dd0a0d32a279da6e88292a09ffc70c5de9))
* **web:** rebuild the Web UI as a blueprint workbench with a Problems and Output panel ([#27](https://github.com/simochee/backlog-blueprint/issues/27)) ([a55b71c](https://github.com/simochee/backlog-blueprint/commit/a55b71c31bea5b052384684ea07d025e89e8f2cc))

## 0.1.0 (2026-09-27)


### Features

* add the export command ([#3](https://github.com/simochee/backlog-blueprint/issues/3)) ([b3b330f](https://github.com/simochee/backlog-blueprint/commit/b3b330f5aace736ee0f7ea98cca07fadb6089af4))
* **cli:** core の描画と計画に繋いで実際に動くようにする ([1fd3a6d](https://github.com/simochee/backlog-blueprint/commit/1fd3a6d21c1317f54d0518a58691b2e74510bd94))
* **cli:** validate / plan / apply を受け取り方と見せ方だけの層として組む ([4ddf599](https://github.com/simochee/backlog-blueprint/commit/4ddf599840acc7dc11fc4fa9db76d3aace032112))
* copy the space's users and teams into access, and write teams by ID ([#5](https://github.com/simochee/backlog-blueprint/issues/5)) ([a77b49a](https://github.com/simochee/backlog-blueprint/commit/a77b49aebcec2dccee34c44b7eb49f291388e465))
* **core:** スペース管理者を administrators に書いた計画を V-B11 で止める ([3c506d4](https://github.com/simochee/backlog-blueprint/commit/3c506d4abe8ba9c265331cdde2dc73aa6ea4ac0d))
* let non-administrators plan and apply, and write people in access by user ID ([#9](https://github.com/simochee/backlog-blueprint/issues/9)) ([6d36dac](https://github.com/simochee/backlog-blueprint/commit/6d36dac8a57e1a3e659df80bdc36b9ac003d45d4))
* レート制限の待機を進捗の行に描く ([9abfbbd](https://github.com/simochee/backlog-blueprint/commit/9abfbbd8a639173358a887f5304db5c2fc64020e))
* 検証エラーの先頭に集計行を出す ([f480104](https://github.com/simochee/backlog-blueprint/commit/f48010471295e2c64c61acc198526caca7ce10d9))


### Bug Fixes

* **cli:** --help の Yaml を YAML に揃える ([a54a752](https://github.com/simochee/backlog-blueprint/commit/a54a75290f6796ed065ada6a60a4056fcb2908e3))
* give up on a Backlog request after 60 seconds without a response ([#10](https://github.com/simochee/backlog-blueprint/issues/10)) ([339f084](https://github.com/simochee/backlog-blueprint/commit/339f084daab9046ce483f55133caa8d5f0f9276f))
* treat environment values as ordinary manifest values ([#4](https://github.com/simochee/backlog-blueprint/issues/4)) ([8c216a4](https://github.com/simochee/backlog-blueprint/commit/8c216a4d960b4402f7d650caf3223a2eba000695))
* コマンドの外に出た例外を握りつぶさない ([f447a3c](https://github.com/simochee/backlog-blueprint/commit/f447a3cec258db7439b2d6b0eef6a7aec084d877))
* 色を書き出す先のストリームごとに判定する ([7258f8f](https://github.com/simochee/backlog-blueprint/commit/7258f8fc0926f104cda94dcc41d929f685c268ca))


### Code Refactoring

* **core:** 描画と応答の読み取りを core から配る ([edeed8a](https://github.com/simochee/backlog-blueprint/commit/edeed8a9a0c3d13db3ed44d990b719fe5faa580c))
* measure comments and module boundaries against one rule before the first release ([#19](https://github.com/simochee/backlog-blueprint/issues/19)) ([08004a3](https://github.com/simochee/backlog-blueprint/commit/08004a31b2c4223c8f23a1c78141514f74b6d2bd))
* 構成を bee に合わせて apps と packages に分ける ([9b33b42](https://github.com/simochee/backlog-blueprint/commit/9b33b42f64bccdc918138fb8c91d6b259f763773))


### Build System

* **cli:** 実行できる1ファイルを書き出す ([d815798](https://github.com/simochee/backlog-blueprint/commit/d8157982b64e308d025abee46b8fb4c266c076fb))
* node の版を mise.toml に集め、公開物に README を含める ([545b8e2](https://github.com/simochee/backlog-blueprint/commit/545b8e26bf3f445e6c66c23778d7a177386103a6))
