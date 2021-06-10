const nodeExternals = require("webpack-node-externals");

module.exports = {
  // モード値を production に設定すると最適化された状態で、
  // development に設定するとソースマップ有効でJSファイルが出力される
  mode: "production",

  // 魔法のコード これを書くと Can't resolve 'fs' が消える
  target: "node",

  // メインとなるJavaScriptファイル（エントリーポイント）
  entry: "./handler.ts",

  module: {
    rules: [
      {
        // 拡張子 .ts の場合
        test: /\.ts$/,
        // TypeScript をコンパイルする
        use: "ts-loader",
      },
    ],
  },
  // import 文で .ts ファイルを解決するため
  // これを定義しないと import 文で拡張子を書く必要が生まれる。
  // フロントエンドの開発では拡張子を省略することが多いので、
  // 記載したほうがトラブルに巻き込まれにくい。
  resolve: {
    // 拡張子を配列で指定
    extensions: [".ts", ".js"],
  },

  // we use webpack-node-externals to excludes all node deps.
  // You can manually set the externals too.
  // 外部依存にしておかないと Can't resolve 'canvas' が jsdomで発生する（わからない）
  externals: [nodeExternals()],
};
