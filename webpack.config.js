//@ts-check
'use strict';

const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js', '.wasm'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }],
      },
    ],
  },
  experiments: {
    asyncWebAssembly: true,
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

/** @type {import('webpack').Configuration} */
const graphWebviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './webview/graph/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'webview', 'graph'),
    filename: 'index.js',
  },
  resolve: {
    extensions: ['.ts', '.js', '.css'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'webview', 'tsconfig.json'),
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: 'graph.css' }),
  ],
  devtool: 'nosources-source-map',
};

/** @type {import('webpack').Configuration} */
const commitDetailsWebviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './webview/commitDetails/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'webview', 'commitDetails'),
    filename: 'index.js',
  },
  resolve: {
    extensions: ['.ts', '.js', '.css'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'webview', 'tsconfig.json'),
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: 'commitDetails.css' }),
  ],
  devtool: 'nosources-source-map',
};

module.exports = [extensionConfig, graphWebviewConfig, commitDetailsWebviewConfig];
