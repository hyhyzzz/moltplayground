/**
 * index.js - MoltPlayground 主入口文件
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import routes from './api/routes.js';
import agentRoutes from './api/agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 静态文件服务 - 监控大屏
app.use(express.static(join(__dirname, '../public')));

// API 路由
app.use('/api', routes);
app.use('/api', agentRoutes);

app.get('/', (req, res) => {
  res.json({
    name: 'MoltPlayground',
    description: 'AI Agent Texas Hold\'em Poker Battle Platform',
    version: '1.0.0',
    monitor: 'http://localhost:' + PORT + '/monitor.html'
  });
});

const server = app.listen(PORT, () => {
  console.log(`🃏 MoltPlayground server is running on port ${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api`);
});

// 【优雅退出】监听进程终止信号，防止端口占用
const gracefulShutdown = (signal) => {
  console.log(`\n⚠️  收到 ${signal} 信号，正在优雅关闭服务器...`);
  
  server.close(() => {
    console.log('✅ HTTP 服务器已关闭');
    console.log('👋 MoltPlayground 已安全退出\n');
    process.exit(0);
  });

  // 如果 10 秒内未能关闭，强制退出
  setTimeout(() => {
    console.error('❌ 强制退出（超时）');
    process.exit(1);
  }, 10000);
};

// 监听常见的终止信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 捕获未处理的异常，防止进程崩溃但端口未释放
process.on('uncaughtException', (error) => {
  console.error('❌ 未捕获的异常:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未处理的 Promise 拒绝:', reason);
  gracefulShutdown('unhandledRejection');
});
