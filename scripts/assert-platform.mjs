const expected = process.argv[2];
if (!expected) {
  console.error('缺少目标平台');
  process.exit(1);
}
if (process.platform !== expected) {
  console.error(`此构建命令必须在 ${expected} 环境运行，当前环境为 ${process.platform}。`);
  process.exit(1);
}
