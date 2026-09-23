# Changelog

## 0.1.0 (2026-09-23)


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
* treat environment values as ordinary manifest values ([#4](https://github.com/simochee/backlog-blueprint/issues/4)) ([8c216a4](https://github.com/simochee/backlog-blueprint/commit/8c216a4d960b4402f7d650caf3223a2eba000695))
* コマンドの外に出た例外を握りつぶさない ([f447a3c](https://github.com/simochee/backlog-blueprint/commit/f447a3cec258db7439b2d6b0eef6a7aec084d877))
* 色を書き出す先のストリームごとに判定する ([7258f8f](https://github.com/simochee/backlog-blueprint/commit/7258f8fc0926f104cda94dcc41d929f685c268ca))


### Code Refactoring

* **core:** 描画と応答の読み取りを core から配る ([edeed8a](https://github.com/simochee/backlog-blueprint/commit/edeed8a9a0c3d13db3ed44d990b719fe5faa580c))
* 構成を bee に合わせて apps と packages に分ける ([9b33b42](https://github.com/simochee/backlog-blueprint/commit/9b33b42f64bccdc918138fb8c91d6b259f763773))


### Build System

* **cli:** 実行できる1ファイルを書き出す ([d815798](https://github.com/simochee/backlog-blueprint/commit/d8157982b64e308d025abee46b8fb4c266c076fb))
* node の版を mise.toml に集め、公開物に README を含める ([545b8e2](https://github.com/simochee/backlog-blueprint/commit/545b8e26bf3f445e6c66c23778d7a177386103a6))
