# 研邮 · Paper-mail

**像查邮件一样，查 PubMed 新论文。**

研邮是一个在自己电脑上运行的 PubMed 文献收件箱，适合需要持续跟进专科研究的临床医生、研究生和生物医学研究者。设好关注的课题和期刊，每天打开收件箱就能看有哪些新论文。

[下载 macOS 桌面版](https://github.com/caid6/paper-mail/releases/download/v2.16.4/Paper-mail-2.16.4-arm64.dmg) · [Windows 桌面版构建说明](#windows-桌面版) · [全部版本](https://github.com/caid6/paper-mail/releases) · [功能介绍](#功能介绍) · [安装与启动](#安装与启动)

[![研邮主界面，左侧是研究方向和文件夹，中间是论文收件箱，右侧是论文摘要和 PDF 阅读入口](docs/images/paper-mail-inbox.webp)](docs/images/paper-mail-inbox.webp)

*公开 PubMed 文献示例。收件箱里可查看期刊、影响因子和研究方向，点开论文即可读摘要或打开 PDF。*

## 功能介绍

- **订阅研究方向。** 用自然语言描述课题，让 AI 生成可编辑的 PubMed 检索式，或直接填入自己的检索式。保存前可查看 PubMed 的实际匹配篇数。
- **按条件收取新论文。** 按期刊和影响因子筛选，按需启用 AI 相关性复核。可以先回溯一段日期内的文献，再每天定时收取。多方向命中的论文只收一次，同时保留对应标签。
- **手工添加论文。** 输入题目、PMID 或 DOI 检索添加，也可以直接上传 PDF。上传后自动提取正文、建立本地索引，并进入中文导读和图文解读队列。
- **像处理邮件一样整理文献。** 浏览未读论文、给重要文献加星标、归档已处理的论文、编辑论文的研究方向标签，并在阅读时写笔记。
- **读摘要、看主图和全文。** 直接查看作者摘要和可用的主图。获取或上传 PDF 后，可在站内阅读。配置模型后，还可以生成中文导读和图文解读，或就全文提问。

## 安装与启动

**macOS 桌面版（Apple Silicon，M 系列芯片）。** [下载 Paper-mail 2.16.4 安装包](https://github.com/caid6/paper-mail/releases/download/v2.16.4/Paper-mail-2.16.4-arm64.dmg)。打开 DMG，将 Paper-mail 拖入「应用程序」，再从「应用程序」启动。已内置 PDF 运行环境，无需安装 Node.js、Python 或单独的 PDF 服务。目前发布的安装包适用于 Apple Silicon Mac，Intel Mac 可使用下方的网页版源码安装方式。

此安装包尚未进行 Apple 开发者签名和公证。若 macOS 阻止首次打开，可在「系统设置 → 隐私与安全性」确认来源后选择「仍要打开」。[安装包与 SHA-256 校验文件](https://github.com/caid6/paper-mail/releases/tag/v2.16.4)

**本机网页版。** 需要 **Node.js 22.13+**；PDF 处理还需要 **Python 3.11+** 及 PDF 依赖。[Node.js 下载](https://nodejs.org/en/download) · [Python 下载](https://www.python.org/downloads/macos/)

**macOS 后台启动。** 将项目放在 `~/Applications/paper-mail`，双击 `启动Paper-mail.command`。终端会显示安装各阶段和依赖下载进度。脚本优先复用项目内的 PDF 环境，检测到解释器失效时会重建。PDF 环境安装失败时，仍可启动研邮收取论文。装好 Python 或修复软件源后，再运行同一脚本即可恢复 PDF 队列。登录时服务自动启动，关闭浏览器后仍会收取论文。双击 `停止后台服务.command` 可取消登录启动。

**自行构建 macOS 桌面版。** 在 Mac 上安装 Node.js、[uv](https://docs.astral.sh/uv/getting-started/installation/) 和项目依赖，再运行下方命令。DMG 文件生成在 `release/`，按构建 Mac 的芯片架构打包；安装 DMG 的用户不需要再安装构建工具。桌面版的论文库、下载文件和模型密钥默认保存在 `~/Library/Application Support/Paper-mail/`，可在「设置 → 数据与导出」查看和更改位置。
```sh
npm ci
npm run desktop:dist
```
开发时可运行 `npm run desktop:dev` 启动桌面窗口。自行打包的应用尚未签名和公证，适合在当前 Mac 上运行或内部测试。

### Windows 桌面版

在 Windows 机器安装 [Node.js 22.13+](https://nodejs.org/en/download) 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)，然后在项目目录执行：

```powershell
npm ci
npm run desktop:dist:win
```

安装包生成在 `release/Paper-mail-2.17.0-Setup-x64.exe`。打包过程会下载并内置 Python 3.12、PyMuPDF、pypdf 和证书，安装后的用户无需另装 Python。开发时可运行 `npm run desktop:dev`；若需要 PDF 处理，先安装 Python 3.11+ 并运行 `npm run setup:python`。Windows 桌面版的文献库、PDF 和模型配置默认保存在 `%APPDATA%/Paper-mail`，也可以在「设置 → 数据与导出」迁移到其他文件夹。当前构建未配置 Windows 代码签名，内部测试时系统可能显示未知发布者提示。

```sh
mkdir -p ~/Applications
git clone https://github.com/caid6/paper-mail.git ~/Applications/paper-mail
cd ~/Applications/paper-mail
./启动Paper-mail.command
```

**已安装的 macOS 用户。** 在原安装目录运行 `git pull --ff-only`，再运行 `./启动Paper-mail.command`。如果准备迁移安装位置，先在原目录运行 `./停止后台服务.command`，再移动整个目录，并在新目录启动。迁移时请一并保留 `data/` 和本机的 `.env`。从桌面、文稿或下载目录启动后台服务可能遇到 macOS 文件访问限制。[Apple 文件访问说明](https://support.apple.com/guide/security/controlling-app-access-to-files-secddd1d86a6/web)

**手动启动。** 在克隆的项目目录执行以下命令，然后打开浏览器。`npm run setup:python` 用于启用 PDF 处理，可单独运行。定时收取需要进程持续运行。[打开本机收件箱](http://127.0.0.1:4317)

```sh
npm ci
npm run setup:python
npm run build
npm start
```

**第一次打开会显示新手指引。** 必须完成模型连接、添加研究方向、初始化文献库、保存每日收取设置这四项配置后才能使用。点击步骤可直接进入相应设置，以后也可以点顶部的问号重新打开。

## 添加自己的订阅

1. **连接模型。** 打开 **设置 → API 与模型**，默认使用 OpenAI 兼容接口。填写模型服务地址和 API Key，用 **读取模型列表** 选择文字和图文模型，也可以手写模型 ID，最后点 **验证并保存**。Google Gemini 也可以在服务类型中选择。
2. **添加研究方向。** 点侧栏 **研究方向** 旁的加号。选择 **AI 生成** 时，可以输入「我想追踪成人高血压的家庭监测和远程管理研究」，生成后检查 PubMed 匹配篇数和检索式。只用 PubMed 时，选 **手动输入**，填写名称与检索式，点 **验证检索式**。两种方式都在确认后点 **保存研究方向**。

3. **选择筛选条件和历史范围。** 在 **设置 → 文献筛选** 按需设定期刊和影响因子。两项都启用时，论文须同时符合。想回溯近期文献，可以在同页选择 **最近 1 个月** 或自定义日期，再点 **按此范围初始化文献库**。
4. **收取论文。** 点侧栏的 **收取最新论文**，或在 **设置 → 每日推送** 调整自动收取时间。默认每天北京时间 07:30，每个启用的方向检查最新 10 篇。服务恢复运行后会补查错过的日期。侧栏和 **最近收信记录** 都能查看结果。

建库可按 **PubMed 建档日期** 追踪新入库记录，也可按 **论文发表日期** 回溯。可在同一区域开关 **自动进行相关性质控**。重新建库只调整订阅范围。手动添加的论文留在收件箱，范围外的订阅论文可在 **已归档 → 移出记录** 查看，已读状态、星标、笔记和 PDF 都会保留。

## 阅读论文

在收件箱右上方点 **手工添加**。选择 **检索论文** 时输入题目、PMID、DOI 或 DOI 链接，核对结果后点击 **添加**；选择 **上传 PDF** 时直接选择本地论文文件。上传后会自动识别文献身份、保存本地 PDF、提取逐页正文并建立索引，随后生成中文导读和图文解读。论文按收信时间入箱，独立于订阅和影响因子设置。检索添加的论文仍会在后台尝试下载公开 PDF。

- **中文导读。** 收件箱按 **收信时间** 倒序，每页默认显示 50 篇。点开邮件后，右侧标注论文发表日期，并可阅读研究问题、核心方法、主要发现和证据局限。打开 **原文摘要** 可以核对作者的表述。
- **图文解读。** 按核心结论、读图要点和子图说明解读可用的 PMC 主图、Nature Portfolio 公开主图或本机 PDF 主图，正文与收件箱采用同样的 14px 字号。点 **全屏阅读** 或直接点击图片，可同时查看原图和中文解读，支持切换主图、缩放图片；按 Esc 退出。作者图注可展开查看，已有内容可点 **重新解读** 按新的精简格式生成。使用 PDF 时，显示含主图的整页，以保留子图和图注。
- **全文问答。** 论文有本机 PDF 时，点 **阅读文献**，一边滚动读全文，一边提问。例如可以问「作者在哪些数据上做了外部验证？」问答使用 PDF 中可提取的文字。按 Enter 发送，按 Shift+Enter 换行。
- **上传 PDF。** 可以在 **手工添加 → 上传 PDF** 中直接导入新文献，也可以在自动获取不可用或失败后上传同一篇论文的文件。文件最大 50 MB、1000 页，PDF 和逐页索引保存在本机。也能从阅读区直接打开 PubMed 或出版社原文。

在论文详情点 **添加标签** 或 **编辑标签**，勾选一个或多个研究方向，也可以取消勾选来纠正归类。后续收信、更新订阅和相关性质控都会保留这些手动选择。

手动归档的论文会出现在 **已归档**。同一页的 **移出记录** 可以查看建库未纳入、被相关性质控筛除，或旧版未记录归档来源的论文。两个列表都可以把论文移回收件箱。

## 模型、全文和数据

**模型要求。** 初始化必须先配置并验证模型服务。检索式和期刊清单生成、中文导读、相关性质控、图文解读及全文问答使用已配置的模型；结构化生成须支持 JSON Object 输出，图文模型还须支持图片输入。通过验证的密钥保存在本机的 `.env`。[环境变量示例](.env.example)

**全文准备。** 项目自带公开 PDF 下载器，可查找 PMC、Europe PMC、受支持的出版社公开全文和 OpenAlex 的开放版本。下载后会核对 DOI 或标题。遇到付费、需登录或自动下载未成功的论文，可从出版社打开原文或上传同篇 PDF。机构访问取决于所在机构的授权和本机配置。PDF 有可提取的文字时才支持全文问答，纯扫描件可以阅读。[全文准备与问答实现](DEVELOPMENT.md#站内阅读与问答)

**安装与连接排查。** macOS 和 Windows 桌面安装包自带 PDF 运行环境；源码版或 `desktop:dev` 报 PDF 环境未就绪时，运行 `npm run setup:python` 后重启服务。默认使用项目的 `.venv`，也可以通过本机 `.env` 的 `PAPER_DOWNLOAD_PYTHON` 指定已有 Python 环境。PubMed 会分别提示 DNS、网络超时和 HTTP 错误。有代理的环境可配置 `HTTPS_PROXY` 和 `NO_PROXY`。模型设置中的 **测试连接** 会分别检查 JSON 和图像输入，并提示密钥、权限或额度错误。

**数据存放。** 服务只监听 `127.0.0.1`。网页版默认使用项目目录，桌面版默认使用 macOS 的 `~/Library/Application Support/Paper-mail/` 或 Windows 的 `%APPDATA%/Paper-mail`：文献库在 `data/papers.sqlite`，PDF 在 `data/downloads/`，主图在 `data/figures/`，模型配置在 `.env`。两种界面均可在「设置 → 数据与导出」查看完整路径；桌面版还可选择新位置迁移数据，并在论文详情点「打开文件夹」定位本机 PDF。PDF 不会上传到 Paper-mail 云端；选择同步盘目录时，第三方同步软件可能同步这些文件。使用 AI 功能时，相关标题、摘要、PDF 提取文本或主图会发送到你配置的模型服务。

**期刊指标。** 采用 2026 年发布的 **2025 JIF** 总表及 10 月修正，优先按 ISSN 匹配。开启影响因子筛选后，只收取并显示有可核验 JIF 且达到门槛的论文。[JCR 发布公告](https://clarivate.com/news/clarivate-releases-journal-citation-reports-2026/) · [官方修正表](https://journalcitationreports.zendesk.com/hc/en-gb/articles/47808147130129-2026)

## 开发与反馈

项目使用 React、TypeScript、Express 和 SQLite。停止本机后台服务后，可用 `npm run dev` 启动开发模式。提交前运行 `npm test` 和 `npm run build`。[开发与交接文档](DEVELOPMENT.md)

欢迎分享你想追踪的课题，或提交收取、期刊匹配和全文阅读中的问题。提交问题时可附上复现步骤、PMID 或脱敏报错。[GitHub Issues](https://github.com/caid6/paper-mail/issues)
