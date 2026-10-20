import { networkInterfaces } from 'node:os';
import { createApp } from '../server/index.mjs';
const port = Number(process.env.PORT || 4318);
const server = createApp({ database: process.env.DATABASE_PATH || './data/clipgarden.sqlite' });
server.listen(port, '0.0.0.0', () => {
  console.log('剪贴花园本机服务已启动（仅用于可信局域网测试，HTTP 未加密）。');
  console.log(`本机客户端：http://127.0.0.1:${port}`);
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!/^(en|eth|Ethernet|Wi-Fi|WLAN)/i.test(name)) continue;
    for (const a of addresses || []) if (a.family === 'IPv4' && !a.internal) console.log(`局域网客户端：http://${a.address}:${port}`);
  }
  console.log('其他设备须连接同一局域网；防火墙需允许该端口。停止服务：Ctrl+C。');
});
