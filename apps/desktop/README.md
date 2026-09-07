# apps-desktop

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

## 局域网部署

Windows 安装包从 `resources/portmax-endpoints.json` 读取不含密钥的服务端地址。当前发行配置指向当前服务主机：

```json
{
  "mastraServerUrl": "http://192.168.0.61:4111",
  "portmaxApiUrl": "http://192.168.0.61:3001"
}
```

客户端可在 `%APPDATA%\\Portmax Desktop\\portmax-endpoints.json` 创建同样的文件以覆盖安装包默认值。服务主机必须仅对可信内网开放 TCP `4111` 与 `3001`；生产环境应通过 HTTPS 或受控的内网反向代理传输登录请求和会话令牌。
