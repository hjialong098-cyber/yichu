# 衣搭

衣搭是一个移动端优先的本地衣柜搭配 PWA。第一版支持拍照/上传衣物、自动抠图、按基础标签管理衣柜、拖拽或点选生成搭配、保存收藏，以及导入/导出本地备份。

## 本地开发

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## Cloudflare Pages

连接 GitHub 仓库后，Cloudflare Pages 使用以下配置：

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`

应用不需要后端、数据库或环境变量。衣物图片和搭配数据保存在用户浏览器的 IndexedDB 中，可通过应用内的导出/导入功能备份。

自动抠图在浏览器端完成，不上传图片。首次使用会下载背景移除模型资源，因此第一次处理会慢一些。
