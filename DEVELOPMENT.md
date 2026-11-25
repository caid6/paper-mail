# 研邮 Paper-mail 开发与交接文档

> 记录运行方式、核心实现与版本变更。每次修改代码后，同步更新运行状态和变更记录。

## 1. 项目目标

Paper-mail 是一个运行在本机的医学人工智能文献收件箱：从 PubMed 按研究方向收取文献，用用户配置的模型生成中文题名和导读，提供原文摘要、全文链接、PDF 自动获取与手工上传、站内 PDF 阅读和全文 AI 问答，以及从 PMC、出版社公开页面或 PDF 获取的主图解读、阅读状态、收藏、归档、笔记和方向标签。

产品主流程是：

1. 在设置中配置研究方向、影响因子条件、初始化文献库范围、每日时间和模型 API。
2. 后台按北京时间自动收取 PubMed 增量文献。
3. 用户打开网页，像使用邮箱一样查看收件箱、未读文献和研究方向。
4. 点击一篇文献，在阅读区查看中文导读、图文解读、原文摘要和全文入口；在站内阅读全文并向配置的模型提问。

当前 UI 名称为“研邮 · Paper-mail”。服务标识 `local.paper-morning`、目录名和旧启动脚本兼容项可以保留，不要为了改品牌而破坏 LaunchAgent。

## 2. 当前版本与运行状态

- 源码版本：`2.14.6`
- 运行地址：<http://127.0.0.1:4317>
- 技术栈：React 19 + TypeScript + Vite；Node.js + Express 5；Node 内置 SQLite。
- 当前全文准备：初始化、手动及每日收信完成后由本机服务自动派发；无需打开浏览器。PDF 下载、全页文本解析、PMC 正文、Nature 公开文章图表和 PDF 主图解读分别排队，不同全文来源独立推进。升级时也会派发当前邮箱未准备或此前失败的文献。
- 当前中文题名：单独保存并排队翻译，不依赖 PubMed 是否提供摘要；已完成的中文导读会迁移其中的中文题名。失败时在阅读页显示状态与重试入口。
- 当前阅读交互：PDF 连续滚动；普通全文问答，Enter 发送、Shift+Enter 换行。
- 模型服务由每位用户在本机配置。服务地址、模型和密钥从本机 `.env` 或进程环境读取。
- 每日收取的默认时间为北京时间 `07:30`，每个方向默认检查 `10` 篇；用户可以在设置中修改。
- 影响因子默认条件为 `IF ≥ 10`，期刊目录采用 2026 年发布的 2025 JIF，并应用当年官方修正。具体期刊与阈值均由用户设置。
- 初始化范围、检索方向、质控状态、文献数量和收取记录属于本机数据，不在公开开发文档中记录。
- 当前数据库状态可通过：

```sh
curl -s http://127.0.0.1:4317/api/state
```

输出中不要复制或展示 API Key。

## 3. 目录结构

```text
src/
  main.tsx                 主界面：邮箱列表、导航、筛选、设置入口
  Reader.tsx               阅读区：导读、图文、摘要、笔记
  Modals.tsx               偏好设置和研究方向编辑
  LibraryPreferences.tsx   影响因子和初始化文献库设置
  JournalFilterEditor.tsx  自然语言生成、增删期刊和预览门槛
  JournalBadge.tsx         期刊影响因子标识
  DownloadPaper.tsx        自动获取一次、失败后上传、站内阅读入口
  PaperReading.tsx         本地 PDF.js 连续滚动阅读、选中文字、Markdown 对话和 Enter 发送
  paper-reading.css        阅读器桌面与手机布局及 PDF 文字层
  DigestProvenance.tsx     导读模型来源、历史模型提示、重新解读
  style.css                全局样式和响应式布局
  types.ts                 前后端共享的前端类型
  dates.ts                 文献日期格式化

server/
  index.ts                 Express 路由、定时任务、同步和后台队列
  core.ts                  SQLite 建表、设置、论文去重和邮箱范围迁移
  initialization.ts        按 PubMed 检索结果事务性重建当前邮箱范围
  subscription-refresh.ts  方向更新时复用初始化窗口并覆盖之后的每日窗口
  pubmed.ts                PubMed E-utilities、日期检索、XML 解析
  library.ts               分页列表、搜索、文件夹和方向计数
  journals.ts              2025 JIF 期刊目录、ISSN 匹配和共用筛选
  journal-plans.ts         AI 期刊筛选方案和目录展开
  ai.ts                    AI 配置、模型列表、结构化生成、普通多轮文本对话、检索词生成
  reading-scope.ts         当前邮箱、影响因子与未完成质控的统一派发条件
  reading-preparation.ts   幂等入队、后台启动与剩余准备篇数
  pmc.ts                   官方 E-utilities/JATS/云端清单、版本与身份核验
  figures.ts               PMC、Nature 与 PDF 主图缓存和视觉解读队列
  downloads.ts             paper-download PDF 获取队列
  documents.ts             PDF 上传、逐页文本存储、整篇全文和历史对话直接调用 API

tests/                     Node 测试，运行 npm test
assets/journals/           影响因子和分区资料
scripts/service.mjs        macOS LaunchAgent 安装、停止、状态
scripts/quality_audit.mjs  使用配置的模型对论文方向命中关系做可追溯质控
scripts/openalex_sources.py  按 DOI 与 OA 标记筛选 OpenAlex 全文链接
scripts/pdf_identity.py     检查 PDF 文件和 DOI/完整标题证据
scripts/read_document.py    验证 PDF 身份并提取所有页面的文字
scripts/extract_pdf_figures.py  按明确的主文图注提取 PDF 页图像
启动Paper-mail.command      安装/启动本机后台服务并打开网页
停止后台服务.command        停止服务并取消登录启动
```

## 4. 启动、停止与开发

首次或源码更新后：

```sh
cd /path/to/paper-mail
npm ci
npm run build
./启动Paper-mail.command
```

常驻服务由 `~/Library/LaunchAgents/local.paper-morning.plist` 管理。查看状态：

```sh
node scripts/service.mjs status
launchctl print gui/$(id -u)/local.paper-morning
```

停止：

```sh
./停止后台服务.command
```

开发模式要先停止常驻服务，再运行：

```sh
npm run dev
```

生产模式会读取 `dist/`。修改前端后必须 `npm run build` 并重启 LaunchAgent，浏览器再刷新；否则用户可能仍看到旧 bundle。

## 5. 配置与密钥

`.env` 是本机私密文件，不提交、不打包、不写入文档。模板见 `.env.example`：

- `AI_PROVIDER`：`gemini` 或 `compatible`
- `AI_BASE_URL`：服务基础地址
- `AI_MODEL`：文字模型
- `AI_FIGURE_MODEL`：图像模型
- `AI_API_KEY`：密钥
- `PORT`：默认 `4317`

网页设置验证文字模型和视觉模型后，将配置写入权限为 `0600` 的本机 `.env`，并更新当前进程。应用向浏览器返回配置状态、服务地址和模型 ID。密钥只由服务端读取。Git 仅跟踪空白示例 `.env.example`。服务只监听 `127.0.0.1`，API 中间件会检查 Host 和 Origin。

## 6. 数据库和去重

数据库为 `data/papers.sqlite`，不要放进源码压缩包。主要表：

- `settings`：每日时间、时区、每方向数量、影响因子、初始化状态和范围等。
- `subscriptions`：研究方向和 PubMed 检索式。
- `papers`：论文、中英文题名、摘要、日期、阅读状态、收藏、归档、笔记、导读和指标；中文题名有独立状态字段，`in_library` 标记是否属于当前初始化范围。
- `paper_subscriptions`：论文与多个研究方向的关联。
- `relevance_reviews`：逐论文、逐方向的相关性复核状态、判定、理由和原文证据。
- `sync_runs`：手动、每日和初始化任务记录。
- `fulltexts`、`figures`：PMC 全文、PMC/Nature/PDF 主图与解读状态。
- `pdf_figure_indexes`、`publisher_figure_indexes`：按 PDF SHA-256 与论文 DOI 保存图表识别状态。
- `downloads`：PDF 获取状态和逐来源尝试结果；上传文件使用 `source=manual-upload`。新增 `automatic` 区分当前邮箱后台任务与显式 API 请求，`index_error` 持久记录 PDF 解析失败；`fulltexts.automatic` 同样参与后台派发条件。
- `pdf_documents`：PDF 文件名、SHA-256 指纹、页数和全部逐页提取文本。
- `paper_chats`：按论文与 PDF 指纹保存问题、模型答案、模型名和时间。

论文按 PMID 去重；一篇论文可以关联多个研究方向，但共用一份已读、收藏、归档和笔记。达到影响因子阈值前会在服务端过滤，未知或有歧义的期刊不会被错误填值。

## 7. PubMed 检索与时间口径

### 每日自动收取

后台每 30 秒检查一次定时条件。北京时间到达设置时间且当天尚未成功收取时，执行 `daily` 任务。每日任务用 PubMed **Create Date / 收录日期 `[crdt]`** 组成增量范围：从上次成功日期查到当天。这样服务器漏跑或电脑晚启动时，会补查中间日期；不是只查当天零点到现在。

PubMed 收录日期适合发现最近进入 PubMed 的新记录，因为正式发表和进入 PubMed 之间可能有延迟。每日成功后才更新 `last_daily_date`；任务报错会保留旧日期，下一次继续重试。

最近一次每日任务由 `/api/state.dailyRun` 提供；`recentDailyRuns` 返回近 7 次每日任务，设置 → 每日推送 → 最近收信记录可展开查看时间、状态和新入库篇数。入库数包含后续质控可能归档的记录。

首页默认按 PubMed 收录日期倒序显示，每页 50 篇；可切换“最新收信时间”排序，也可选择 15、25 或 50 篇。研究方向右侧数字显示该方向当前总篇数，鼠标提示同时给出未读数。原来的数字是未读数，容易被误解为总量。

最近一次每日任务由 `/api/state.dailyRun` 提供，侧栏显示当天待收、进行中、成功新增篇数或失败状态；任务在当天完成时显示一次提示。这样刷新页面后仍可确认任务结果。新安装默认每方向检查 10 篇；升级时将旧默认值 8 更新为 10，其他已设置数量不变。

### 初始化文献库

设置路径：`设置 → 文献筛选 → 初始化文献库`。

支持最近 7 天、1/3/6 个月、1 年或自定义日期；按 PubMed 收录日期 `[crdt]` 或发表日期 `[pdat]` 检索；每方向可设置 1–5000 篇纳入上限。

点击“按此范围初始化文献库”后，服务按每个启用方向检索最多 N 篇，核对 PubMed 声明的结果总数和返回 PMID，再分批读取完整记录。所有方向都成功后，数据库事务才会提交新集合。任一方向失败或数据不完整时，当前文献库保持不变。

初始化不是增量补收。每次成功执行都会重新定义当前邮箱范围：本次结果中的 PMID 纳入当前邮箱；原有但本次未命中的 PMID 移到“已归档”，不会删除论文、笔记、已读/星标状态、主图或 PDF。重新选择更短时间窗会缩小收件箱；已归档论文可手动恢复。

初始化会应用指定期刊与影响因子的交集和研究方向标签。相同 PMID 跨方向去重；既有记录沿用其导读和阅读状态。手动归档的文献仍保持归档。

初始化成功后，`library_initialized_on` 记为完成日。每日任务和“收取最新论文”继续使用 PubMed 收录日期增量查询，从 `last_daily_date` 与初始化完成日中较新的日期查到当天。该每日机制不改变本次初始化按 `[pdat]` 或 `[crdt]` 选定的建库窗口。

初始化状态和最终邮箱篇数保存在 `initialize_status`、`initialize_start/end`、`initialize_matched` 和 `initialize_inbox`。以前版本的 `backfill_*` 设置仍保留用于范围选择和迁移兼容。

期刊清单和影响因子的交集在 PubMed 侧使用 NCBI History 期刊集合。每个集合最多包含 400 个权威 ISSN；多个集合合并后与研究方向相交。继续使用同一 WebEnv 做二次检索时必须携带 `usehistory=y`，否则 PubMed 会将 `#1` 等集合引用判为 `Wrong subquery` 并返回 0；服务端也会把这类警告直接视为任务错误，避免静默显示 0。集合阶段已确认的缺失 ISSN 会传给最终错误校验，其他检索词错误仍会使任务明确报错。

### 研究方向检索式更新

医疗智能体默认式版本 3 使用 agentic、明确 AI/LLM agent 短语，以及“多智能体/自主智能体＋AI/完整语言模型名称”的布尔组合；医疗场景覆盖 health、diagnosis、radiology、biomedical、drug discovery 等标题摘要词。固定短语使用 PubMed 支持的截词表示单复数，不限定只出现缩写 LLM。不使用泛化的 `agent* AND artificial intelligence` 任意共现，避免把药物 agent 当成智能体。真实 PubMed 预检应为 0 条未识别警告，不能为了消除报错而静默删检索词。

添加或修改方向时，先验证 PubMed 检索式并核对已有记录标签；同时在当前建库窗口和初始化之后至今天的收录窗口内重新检索该方向，按当前 IF 阈值与每方向初始化上限取文献。`subscriptionDateClause` 保留原窗口的日期口径（crdt/pdat），每日扩展段使用 crdt；未初始化时使用日常每方向数量。所有远端读取与身份核验完成后，`saveSubscription` 在同一事务提交检索式、该方向标签和缺失论文；任何写入失败时回滚。不重新初始化其他方向、不删除阅读记录。并发旧质控结果返回时检查方向检索式版本，变化后不覆盖新结果。

默认式迁移与手动同步、方向编辑共用文献库串行锁，避免启动时同时改写方向；迁移只匹配应用过去发布过的完整默认式，不覆盖用户自定义式；`pubmed_quality_query_version=3` 成功后记录。迁移前本机已保存数据库快照到 `data/backups/`，不放进源码包。

PubMed ESearch 的取前 N 篇改用 `sort=most recent`（加入 PubMed 的时间）；原实现误用 `pub date`，会按论文发表时间选择前 N 篇，与“最新收录”设置文案不符。

### 相关性质量控制

PubMed 的主题词检索只能证明标题或摘要中出现了检索概念，不能证明该方向是论文的核心内容。每次建立论文与方向关联后，后台使用当前文字模型依据标题、作者摘要、方向名称和检索式返回三类判定：`relevant`（核心相关）、`borderline`（边界相关）和 `irrelevant`（明确无关）。每条判定保存理由和原文证据；摘要缺失或证据不足时保留为边界项。

明确无关的方向标签会被移除；一篇论文没有其他有效方向标签时只归档，不删除 PMID、摘要、笔记或阅读状态。边界项保留在收件箱。用户可在“初始化文献库”区域启用或关闭自动质控，关闭时质控队列暂停，重新开启后继续处理未完成项目；开关也影响每日和手动收取。已发出的模型请求返回后会检查开关状态，关闭期间的结果不会应用。模型服务不可用时保留待质控状态，不把失败当成“无关”。

### 手动收取

“收取最新论文”调用 `/api/sync`，按 PubMed 收录日期收取当前范围后的新记录；初始化前执行当前方向最新检索。初始化必须通过设置中的“按此范围初始化文献库”明确启动。

### 期刊目录和自然语言筛选

`assets/journals/catalog.json` 使用 SciencePub 汇总的 2026 JCR 六月工作表和 Clarivate 2026-10-14 发布的 336 项 JIF 修正。22,643 本按期刊及 ISSN 去重，保留未公布 JIF 和 <0.1 的区别。JCR 学科四分位采用六月工作表，10 月修正公告只用于覆盖 JIF。中科院分区来自原有 2025 年本机资料，仅供参考。来源和原始文件 SHA-256 随目录保存。使用 Nature 官网对照核验 104 项同年 JIF，排除官网表头。核实的额外期刊身份来自 `supplemental-identities.json`，包括 46 本系列刊及 2 本本地 PubMed 库未匹配的期刊。明确区分 8 本暂停公布和目录暂无 2025 JIF 的期刊。通过 `python3 scripts/build_journals.py jcr.xlsx reload.json nature.html suppressions.json` 重建目录，依赖 openpyxl 和 beautifulsoup4。

- [六月数据下载页](https://www.sciencepub.cn/download/)
- [Clarivate 暂停公布名录](https://journalcitationreports.zendesk.com/hc/en-gb/articles/28351398819089-Title-Suppressions) 与 [JSON 源](https://journalcitationreports.zendesk.com/api/v2/help_center/en-gb/articles/28351398819089.json)
- [Clarivate 10 月修正](https://journalcitationreports.zendesk.com/hc/en-gb/articles/47808147130129-2026) 与 [JSON 源](https://journalcitationreports.zendesk.com/api/v2/help_center/en-gb/articles/47808147130129.json)
- 期刊系列参考 [Nature Portfolio](https://www.nature.com/nature-portfolio/about-journals/journal-metrics)、[Cell Press 刊表](https://www.elsmediakits.com/sites/default/files/2024-04/Cell%20Press_MediaKit_2024_V2.pdf) 和 [AAAS Science](https://promo.aaas.org/joinus/discover-science/)。收录的系列成员可在页面增删，未匹配的成员在生成后提示计数。

AI 解析所选系列、JCR 学科或明确刊名、排除项及明确给出的最低 JIF。OpenAI 兼容服务按 [DeepSeek JSON 模式](https://api-docs.deepseek.com/guides/json_mode/) 请求，服务端仍用 Zod 校验结构，再按目录确认刊名与 ISSN。范围含糊的条目显示为待确认。用户说不要纳入 N 以下时解析为含下限 `gte`，所以 N.0 纳入。只有明确说严格大于或不含等于时使用 `gt`。解析和存储保留比较方式，预览、SQL、PubMed History 期刊集合和入库校验都执行同一条件。旧设置缺少 `min_impact_operator` 时使用含下限。保存选定的 ISSN 和描述，收件箱、方向计数、后台准备、初始化、方向更新、手动与每日收取共用期刊条件。合格期刊有多个 ISSN 时，PubMed 使用其全部唯一 ISSN。交集为空时得到零结果。初始化与邮箱范围一同事务提交期刊条件。

## 8. 重要 API

所有 API 都是本机 `/api` 路由，并设置 `Cache-Control: no-store`。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/state` | 设置、订阅、统计、AI 状态和任务；`dailyRun` 为最近一次每日记录，`recentDailyRuns` 为近 7 次记录 |
| GET | `/api/papers` | 分页、搜索、文件夹和阅读状态筛选 |
| GET | `/api/papers/:id` | 论文详情 |
| PATCH | `/api/papers/:id` | 已读、收藏、归档、笔记 |
| POST | `/api/papers/bulk` | 批量已读/未读/归档/收藏 |
| POST | `/api/sync` | 手动收取最新论文 |
| PUT | `/api/settings` | 每日时间、时区、每方向篇数、自动收取 |
| PUT | `/api/preferences` | 保存 IF 门槛、期刊清单和初始化设置 |
| GET | `/api/journals/search?q=...` | 查找目录中的刊名、别名或 ISSN |
| POST | `/api/journals/generate` | 使用配置的模型生成并校验期刊清单，仅返回预览 |
| POST | `/api/initialize` | 先完整检索所有启用方向，再事务性地重建当前邮箱范围 |
| POST | `/api/papers/:id/digest` | 重新生成中文导读 |
| POST | `/api/ai/test` | 真实测试文字和图像模型 |
| POST | `/api/ai/models` | 读取模型列表 |
| PUT | `/api/ai` | 验证并保存模型配置 |
| POST | `/api/subscriptions/generate` | 自然语言生成检索方案 |
| POST | `/api/subscriptions/preview` | 验证 PubMed 检索式 |
| POST | `/api/subscriptions` | 新建研究方向 |
| PUT | `/api/subscriptions/:id` | 修改方向，并在当前建库/每日窗口内重新检索和更新标签；返回 added/matched |
| GET | `/api/papers/:id/figures` | 主图解读状态 |
| POST | `/api/papers/:id/fulltext` | 显式安排 PMC 全文任务；正常阅读页面不调用 |
| GET/POST | `/api/papers/:id/download` | 兼容旧版 PDF 状态/启动接口，当前 UI 不再提供手动重试 |
| GET | `/api/papers/:id/document` | 下载与逐页解析状态，包含无文本页码；不返回文件路径或全文文本 |
| POST | `/api/papers/:id/document/ensure` | 显式准备 PDF 的兼容 API；正常阅读页面只 GET 状态 |
| POST | `/api/papers/:id/document/upload` | 自动下载失败后上传原文，Content-Type: application/pdf，原始字节体，上限 50 MB |
| GET/POST | `/api/papers/:id/chat` | 读取当前 PDF 对话/整篇全文普通对话；answer 为 Markdown 字符串 |
| POST | `/api/papers/:id/chat/reset` | 清空当前 PDF 对话 |
| GET | `/api/papers/:id/pdf` | 打开或下载已验证为可解析的 PDF 文件 |
| GET | `/api/export` | 导出星标论文 Markdown |

## 9. AI 与后台队列

中文题名使用单独翻译队列，只发送标题；摘要导读把标题、作者、PubMed 摘要和元数据发送给用户选择的模型。两者均使用 JSON Object 返回并由服务端校验结构。图文解读会把真实主图、图注和正文引用段落发送给图像模型。

导读最多两个并发 worker。论文保存时记录 `digest_model` 和 `digest_at`；模型配置变化不会伪造旧导读来源，阅读页会显示历史模型并提供“用当前模型重新解读”。模型请求失败保留旧导读并记录 `digest_error`。

相关性质控使用两个并发 worker，结果写入 `relevance_reviews`。明确无关的方向关系会移除，完全没有有效方向的论文归档；请求失败保留 `pending/error` 状态，不据此归档。

PDF 队列优先使用已核验的 PMC 官方云端 PDF，之后依次尝试 PubMed/PMC、Europe PMC、OpenAlex 明确标记的开放全文、出版社公开 PDF 和支持的机构访问。Europe PMC 记录的 PMID/PMCID/DOI 和 OpenAlex 的 DOI 必须与论文匹配，只尝试明确标记的开放获取链接；OpenAlex 链接同时通过 DOI 匹配、OA 标记和 HTTP(S) 校验。每次尝试都校验文件路径、PDF 文件头、可读页数和前三页/元数据中的 DOI 或完整标题；允许有明确标题证据的文件，不用相似度推测，也不接受无法确认身份的 PDF。失败时持久保存逐来源状态与原因，阅读页可展开查看。

### PMC 主图的自动获取

采用 [PMC 官方数据服务](https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/) 的 E-utilities + Cloud 路径，官方格式和版本结构见 [云端 README](https://pmc-oa-opendata.s3.amazonaws.com/README.txt)。E-utilities 的请求起始时间共享串行限速门，至少相隔 400ms。先验证 XML 的 PMID/PMCID 和明确的 pmcid-ver，然后读取该版本 JSON 清单，验证清单 PMID、PMCID、version；读取清单 xml_url，重新验证正文身份，并只取正文主图。

JATS graphic 的文件名必须与 media_urls 完全匹配，不按扩展名或相似度猜图像。云端 URI 仅允许指定 bucket 和本篇版本目录。主图按真实 PNG/JPEG/GIF/WebP 文件签名判别类型，兼容 S3 的 binary/octet-stream；清单带 MD5 时核验内容一致性，缓存到本地后才显示。视觉调用使用实际图像、图注和引用段落，保存所选 figure_model，单图 maxOutputTokens=20000。无公开云端文件或图像不完整时记录 unavailable，正文主图不会由摘要或 PDF 页面猜造。旧 HTML 解析器保留在测试中，自动任务不再抓取 PMC 网页；已完成旧记录继续使用。图片许可原文保留，界面折叠展示。

### Nature 与 PDF 主图

收信准备队列先按论文 DOI 读取 Nature Portfolio 的公开文章页，只接受与 PubMed DOI 一致的页面和 `media.springernature.com` 图片；解析编号正文图和作者图注，排除补充图。PDF 解析需 Python `requirements.txt` 中的 PyMuPDF，逐行识别 Figure/Fig. 编号作者图注，确保图注可从 PDF 文本层校验；向视觉模型发送原始整页，保留完整的多子图布局，不猜裁切边界。出版社公开图像可用时优先采用，未取得的图号由 PDF 图页补齐。PDF SHA-256 保存在 `pdf_figure_indexes`，Nature DOI 状态保存在 `publisher_figure_indexes`。所有图像使用本机配置的视觉模型解读，PMC 若有结构化主图优先展示。

### 站内阅读与问答

`prepareReading` 在初始化事务提交、手动/每日收信结束、相关性质控任务结束、方向保存、筛选设置/API 变更、归档恢复与服务启动时运行。先按 `readingScope` 为当前非归档、库内、符合 IF 的 PubMed 文献幂等入队；启用质控且模型已完整配置时跳过仍有 pending/running 方向复核的记录。复核网络失败保持文献在邮箱，失败项不会被当作无关归档。关闭质控时允许按检索结果准备。多方向共用每 PMID 的一份 PDF、解析和主图。

`downloads`、`fulltexts` 保存队列状态。单篇下载、PDF 全页解析、PMC 获取和逐图解读分别运行。PMC 文献先获取官方清单，再优先使用明确的云端 PDF；其他论文继续既有下载链路。下载成功立即派发全页解析。出版社页面只提供部分图片时，PDF 主文按图号补齐缺失的图，不重复展示同一图号。主图即使未配置模型也先缓存，配置模型后恢复视觉解读。服务启动时 running 下载、loading 全文和 generating 图像恢复 pending；版本升级会重新识别此前失败或新版规则可处理的图片。PDF 解析错误保存在数据库，缺失文件标明 interrupted；移出当前范围的待处理自动任务不派发，恢复入库后继续。已在执行的单篇请求允许结束，结果保留。

`DownloadPaper` 和 `Figures` 只 GET 状态与已缓存文件，不 POST 启动全文获取；`document/ensure` 作为显式 API 保留。自动失败的 `needs_browser/unavailable/error/interrupted` 显示上传入口，成功显示阅读与下载。后台从 PMC 或 Nature Portfolio 可核对的公开图表获取主图；有本机 PDF 时按文中主图编号和作者图注提取整页图像，并用于补充出版社页面未能取得的图号。首页原有底部状态显示 `readingPreparation.pending` 篇全文或主图正在准备，不增加操作按钮。阅读器按需加载 `pdfjs-dist@5.4.624` 与本地 worker，无外部 CDN；全部页面按实际尺寸连续排列，每页 Canvas + TextLayer 支持缩放和选中文字；IntersectionObserver 按阅读视口渲染附近页面像素，远离视口的 Canvas 释放内存，所有页面占位尺寸保持稳定，桌面左右阅读/问答，手机切换；关闭返回原邮箱阅读区。

自动下载成功后异步提取所有页面，提取任务按论文去重。手工上传同样先通过 `pdf_identity.py` 核对 DOI 或完整标题，再由 pypdf 提取每一页。PDF 图文提取使用 `requirements.txt` 中的 PyMuPDF。最多 50 MB / 1000 页、解析超时 120 秒。空白页保持空文本且返回页码，不用摘要代替全文，不做 OCR。上传验证完成后持久保存文件和逐页文本；后台失败原因可以展开查看。文件在本地缺失时，明确标为 `interrupted` 并允许上传。

问答使用请求发起时的 `activeAI()` 当前文字模型。每次发出整篇逐页提取文本、本篇当前 PDF 完整历史与问题，直接调用普通对话 API：OpenAI 兼容接口不传 `response_format`，Gemini 不传 JSON Schema 或 JSON MIME；回答是原始 Markdown 文本。不做向量检索、片段筛选、强制引用、页码/行号校验、固定段落格式或摘要替代；不再设置 240000 字符的应用级输入门槛，实际上下文限制以模型服务为准。输出最多 20000 tokens，调用失败或未完成会明确报错，不保存不完整回答、不切换模型。正文像素的按需渲染只影响浏览器内存，AI 请求仍包含全部页面文本。

`paper_chats.answer` 新记录保存 JSON 编码的回答字符串；读取 2.10 的 paragraph/citations 对象时明确转换为其原始段落与 missing 文本，不修改旧记录，不显示引用按钮。历史消息以标准 user/assistant 角色发送并记录实际模型名；同篇同时只允许一个请求。Markdown 使用 react-markdown + remark-gfm，支持标题、列表、代码和表格，不执行原始 HTML。全文问答目前只有 PDF 文本，不接收图像；纯扫描 PDF 无法问答。

输入框 Enter 发送、Shift+Enter 换行。通过 composition 事件、`isComposing` 与输入法 keyCode=229 区分确认选词和发送；同步提交锁防止连按 Enter 重复请求，发送后仍可继续编辑下一条问题。对话区单独滚动，不影响左侧连续阅读位置。

## 10. UI 约定

首页保持邮箱工作流：收件箱、未读、星标、归档、研究方向、搜索、手动收取和阅读区。订阅条件放在设置，不要把影响因子或其他筛选入口重复放到首页。

视觉上使用蓝白邮箱风格：保留浅色分隔线、选中底色和少量标签；标题是列表核心，期刊、IF、日期和方向标签是辅助信息。新增功能优先放进现有设置分类或阅读区，避免增加宣传性文案、重复统计和无意义按钮。

## 11. 验证与发布

每次修改至少运行：

```sh
npm test
npm run build
```

当前 64 项 Node 测试与 9 项 Python 测试全部通过，生产构建通过。端到端测试覆盖后台 PDF 下载、全文图注提取、PMC 与 Nature 图表获取、所选模型视觉解读，以及出版社部分图像由 PDF 补齐。

涉及 UI 的修改还要：

1. 重启 LaunchAgent。
2. 刷新本机网页。
3. 检查桌面和手机宽度。
4. 验证设置入口、阅读入口和主要交互的可访问名称。
5. 如生成预览图，保存在 `outputs/` 外层，源码包不要包含数据库、日志、`dist`、`node_modules` 或 `.env`。

需要离线复核现有命中关系时运行 `node scripts/quality_audit.mjs`；它只写入 `/tmp/paper_quality_audit.json`。带 `--apply` 才会更新方向关联和归档状态，运行前应确认质控结果。

## 12. 后续修改协议

每次代码修改完成后，必须同步完成以下事项：

1. 更新 `package.json` 和 `package-lock.json` 版本号（有用户可见变化时）。
2. 更新本文档的“当前版本与运行状态”、相关功能章节和最后的变更记录。
3. 在 README 的功能说明与命令发生变化时同步修改 README。
4. 为新的通用逻辑补充有意义的测试；不要只写重复实现的 UI 测试。
5. 运行 `npm test`、`npm run build`，并记录通过数量或失败原因。
6. 重启本机服务并检查 `/api/state`，确认实际运行配置与文档一致。
7. 在最终交接说明中列出修改文件、验证结果、当前服务状态和未完成事项。

不要把密钥、数据库、服务日志或浏览器个人数据写入源码包。不要通过伪造模型名、论文日期或影响因子来掩盖数据缺失。

## 13. 变更记录

### 2.14.6（2026-11-25）

- 收件箱默认按 PubMed 收录日期倒序，每页显示 50 篇；保留收信时间排序和 15/25/50 篇选择。
- GitHub README 增加桌面界面截图，图片保存在 `docs/images/paper-mail-inbox.webp`。截图由实际界面渲染，收件箱使用公开论文和示例订阅。
- README 按首次使用流程组织，补充预置方向试收、自定义研究方向示例、期刊筛选与初始化的操作入口，并说明模型和全文功能所需的环境。
- 64 项 Node 测试、9 项 Python 测试和生产构建通过；后端默认值、前端初始值及测试均已覆盖。

### 2.14.5（2026-11-24）

- 将中文题名从摘要导读中独立出来持久化，初始化后单独排队翻译；PubMed 没有摘要的记录仍可生成中文题名。收件箱、阅读页、全文阅读标题、中文搜索和导出均使用独立译名，同时保留英文原题。翻译失败可在阅读页重试。
- PDF 下载、PMC 正文、出版社页面和图像解读按独立队列推进；出版社页面只提供部分图片时，以 PDF 主文中缺少的编号图补齐，不重复加入相同图号。启动时重新处理此前失败或新版可识别的主图、PDF 图注与题名任务。
- PDF 主图识别逐行读取文本，接受带句点或无标点的编号 `Figure/Fig.` 图注，并跳过补充图和 Extended Data 图注。仍以可验证的作者图注定位页面，交给视觉模型的是原始整页图像。
- 63 项 Node 测试、9 项 Python 测试和生产构建通过。端到端测试覆盖仅部分出版社图片可用时，由 PDF 补图并完成模型解读。服务器版本回归实测为 `2.14.5`，后台使用本机保存的模型配置。

### 2.14.4（2026-11-24）

- DeepSeek 兼容接口结构化生成改用 `json_object`，服务端继续用 Zod 校验返回内容。启动时将对应失败的导读、质控和 PMC 图文重新加入任务队列。
- PDF 自动下载及手工上传后按主文编号图注逐页提取图表上下文，将 PDF 整页图像提交视觉模型。Nature 公开图像按 DOI 匹配并优先使用；PMC 正文主图可用时继续优先使用 PMC。
- 界面区分 Nature、PMC 与 PDF 图源，显示 PDF 页码，解释图文准备状态。新增 PyMuPDF 依赖和出版社图表失败重试。
- 将因 PDF 图文准备失败而停止该文档索引的逻辑改为独立队列。PubMed 官方摘要缺失时仍可读取 DOI 验证的 Nature 文章页图表，不受 PMC 元数据状态阻断。
- 57 项 Node 测试、7 项 Python 测试和生产构建通过。使用本机配置模型实测真实中文导读和真实 Nature 主图解读。

### 2.14.3（2026-11-24）

- 移除预填的模型 ID 和第三方兼容接口地址。没有填写本机 API 配置时，后台不派发模型任务。
- 公开模板不含密钥。忽略 `.env` 和 `.env.*`，仅保留空白的 `.env.example`。部署文档说明各用户在本机验证并保存配置。
- 公共开发文档改为通用运行说明，移除本机订阅和收件箱快照。
- 隔离安装测试覆盖未配置状态、填写后验证保存、密钥文件权限和响应内容。54 项 Node 测试、5 项 Python 测试和生产构建通过。本机服务已重启，既有配置读取正常。

### 2.14.2（2026-11-24）

- 按用户确认将默认影响因子条件固定为 IF ≥ 10，10.0 期刊纳入。旧配置缺少比较方式时自动写入 gte。
- 自然语言中“不要纳入 IF 10 以下”“10 分以上”“至少 10”统一解析为含下限，只有明确说严格大于或不含等于时才排除 10.0。
- 本机服务实测收件箱 101 篇、IF 10、比较方式 gte，最近一次每日任务成功。53 项 Node、5 项 Python 测试与生产构建通过。
- 创建公开仓库并推送源码。数据目录、构建产物、依赖目录和本机密钥均由 .gitignore 排除。
- 重写 GitHub 首页 README，补充目标读者与使用场景，整理部署、订阅和阅读说明，并补充仓库简介和主题标签。


### 2.14.1（2026-11-23）

- 支持严格大于和含下限两种比较方式。当前默认是 `IF ≥ 10`，生成方案、手动比较方式、偏好持久化、初始化、邮箱与 PubMed 检索同步生效。符合条件的期刊默认展开，低于门槛或无 JIF 的期刊在当前排除项中可查。
- 核对 22,643 本六月 JCR 总表和 336 条十月修正。交叉核对 Nature 官网的 104 项 JIF，排除了误计为期刊的 5 个栏目标题。追加 48 本有可验证 ISSN 的期刊身份，对暂无 2025 JIF 的记录保留空值，并标注 8 本 JIF 暂停公布的期刊。
- 53 项 Node 测试、5 项 Python 测试和生产构建通过。边界回归覆盖 JIF 正好为 10 的期刊，确认 `gte` 纳入、`gt` 排除。服务已重启。当前状态为 IF 10、比较方式 gte、收件箱 101 篇。

### 2.14.0（2026-11-23）

- 2025 JIF 切换为 2026 JCR 数据，覆盖 22,643 本并应用 336 条官方修正。启动时重新计算本地论文的期刊匹配和 JIF。
- 文献筛选增加自然语言期刊清单，支持预览、刊名或 ISSN 添加、移除、清空及与 IF 取交集。胃肠顶刊默认采用胃肠病学与肝病学 Q1，JIF 实际值来自目录。使用当前模型在浏览器实测，综合示例生成 193 本可匹配期刊，124 本达到 IF ≥ 10。另用四大刊清单与 IF ≥ 10 实测 PubMed History 检索，返回的样本来自 Lancet 和 JAMA。
- 为出版社 PDF 已就绪但 PubMed 缺少 PMCID 的论文返回明确图文状态。PMID 43058249 经 NCBI 编号转换接口核对尚无 PMCID，PDF 可读，Nature Biotechnology 显示 2025 JIF 44.5。
- 51 项 Node 和 5 项 Python 测试及生产构建通过，后台服务已重启。文档、版本和锁文件同步更新。

### 2.13.0（2026-11-23）

- 把全文获取、全部页解析、PMC 主图与图文解读接到检索后的服务端队列，初始化和每天收信无需等用户点开论文。启动升级时自动准备当前邮箱积存文献，相关性质控结束后补派发，重复收信按 PMID 复用结果。
- 新增 reading-scope.ts、reading-preparation.ts、pmc.ts；更新 server/index.ts、core.ts、downloads.ts、documents.ts、figures.ts、ai.ts 与 scripts/download_bridge.py。队列持久化并支持服务重启继续，PDF 解析错误持久化，终态失败保持可手工上传。
- 新任务使用官方 PMC XML 与 Cloud 清单，严格核验 PMID/PMCID/版本和文件名；优先下载清单提供的 PDF。真实云端 binary/octet-stream 图像以标准文件签名识别并核验 MD5，缓存后直接显示，避免阅读页重新请求远端图像。
- src/DownloadPaper.tsx、Reader.tsx、types.ts、main.tsx 移除页面打开时的下载/主图获取启动请求，只显示准备结果与当前排队状态。图片来源许可折叠显示；复杂主图输出预算提升到 20000 tokens，错误不当作已完成。
- 48 项 Node、5 项 Python 测试与生产构建通过，已备份数据库并重启 gui/501/local.paper-morning。真实库保持 101 篇；本机配置的模型已自动生成新增主图解读，仍有后台任务执行。对权限不足和实际网络失败保留真实原因，不保证所有论文都能取得原文。
- 2026-11-23 15:43 北京时间验收快照：收件箱 101 篇，47 份 PDF 已完成全部页解析、36 张主图解读完成、45 篇仍有准备任务；后续任务继续执行。对比升级前快照，原有已读/收藏/笔记变动数为 0。当前文字与图文模型均为 用户本机配置的模型，定时仍为 07:30。
- README、版本号、锁文件和本文档同步更新。实际运行状态以 /api/state 和持久化队列表为准。

### 2.12.0（2026-11-23）

- 核对每日日志：11-21 07:30 成功入库 4 篇（后续 2 篇质控归档）、11-22 07:30 成功入库 0 篇、11-23 07:30 成功入库 2 篇。21 号收到的论文源记录日期是 20 号；23 号两篇源记录日期是 22 号，旧列表日期造成漏推误解。
- 首页默认按收信日期，保留 PubMed 收录排序；方向右侧改成总篇数并用提示给出未读数。侧栏收信状态增加时间，设置加入折叠的近 7 次收信记录。
- 更新医疗智能体默认式版本 3：补足 agentic、多智能体与完整语言模型名称、健康/影像/药物研发等场景；旧式全库候选 887、当前窗口 89，新式全库候选 1781、当前窗口 135（候选不是全部相关论文）。新式 PubMed 无未识别警告。IF ≥ 10 后 18 篇；真实 相关性复核后 12 篇核心相关、1 篇边界相关留在方向中，总数从 6 增至 13，未读从 3 增至 10。
- 修复修改方向只重新打标签、不会找回当前窗口漏文献的问题：新增 `server/subscription-refresh.ts`，方向保存前按初始化窗口和之后的每日窗口检索，事务提交新检索式、文献与方向标签，保护其他方向与私人记录。修复 ESearch 取前 N 篇时误用发表日期排序，改为 most recent。
- 与升级前数据库快照逐条核对，既有论文的已读、星标和笔记变更数均为 0。收件箱现为 101 篇、94 篇未读；定时仍是每天北京时间 07:30。
- 桌面 1365×900 与手机 390×844 已检查：方向显示 13 篇，默认“最新收信”，设置里可展开 23/22/21 号成功记录；手机表格宽度与容器均为 317px，无水平溢出。
- 43 项 Node 测试、5 项 Python 测试和生产构建通过；覆盖按收信排序、方向窗口、去重、回滚与私人记录保护，NCBI 请求断言 most recent。服务已重启并实际完成默认式迁移与质控。


### 2.11.0（2026-11-23）

- PDF 改成自上而下连续滚动，取消逐页切换按钮与页码输入框；保留缩放和文字选择。使用实际页面尺寸保持整篇布局，视口附近渲染像素并释放远处 Canvas，适用于长文献。
- 全文问答直接调用已配置模型的普通对话 API，发送整篇正文与完整历史，取消引用/行号/JSON 输出限制及 24 万字符输入门槛。回答直接呈现 Markdown；旧对话按原段落显示并保留数据库记录。
- Enter 发送、Shift+Enter 换行，确认中文输入法选词时不发送；增加同步提交锁，回答期间可编辑下一条问题，回答结束后保留输入框中尚未发送的文字。
- 已检查桌面 1365×900 和手机 390×844：连续阅读显示相邻页面，可滚动至第 12 页，末页仅保留附近 2 个 Canvas，缩放无控制台错误。服务重启后两轮对话均保留，当前收件箱 96 篇、未读 89 篇，每日 07:30 开启且 2026-11-23 收取成功。
- 已在 PMID 43052352 的 12 页论文上实测连续滚动跨页、Shift+Enter 换行和 Enter 使用本机文字模型提问；收到自由分析回答，历史对话继续显示，无引用按钮，浏览器无控制台错误。中文输入法保护已实现，IAB 不支持 `Input.imeSetComposition`，本轮未实测原生输入法选词。
- `npm test` 39 项 Node 测试和 5 项 Python 测试通过，包含普通兼容接口、Gemini、多轮历史、超过旧 24 万字符门槛的全文无截断发送、旧回答转换及失败后不保存且可继续提问。`npm run build` 通过。
- `src/PaperReading.tsx`、`src/paper-reading.css` 负责连续阅读与对话交互；`server/ai.ts` 增加普通文本 API，`server/documents.ts` 改为全文多轮消息；相关测试、README、版本号与锁文件同步更新。


### 2.10.0（2026-11-20）

- 移除阅读页“获取原文/重新获取”操作。打开论文时自动获取一次；失败后显示“上传 PDF”，再次打开保留失败状态，不反复下载。自动取得 PDF 时显示“阅读文献”和下载入口。
- 增加站内 PDF.js 阅读器：翻页、缩放、文字选择、左右并列 AI 问答和手机 PDF/问答切换。问答使用当前配置模型，回答引用可直接回到对应 PDF 页。
- 增加原始 PDF 上传接口、50 MB / 1000 页限制和 DOI/完整标题核验；自动下载与上传共用逐页文本提取、阅读和问答。错误文件不关联到论文，本地文件缺失会明确提示并允许上传恢复。
- 增加 `pdf_documents` / `paper_chats`，保留文件指纹、全部逐页文本、模型名、时间和问答记录。完整正文加对话超过 24 万字符时明确拒绝，不截断全文；无文本页明确提示，纯扫描 PDF 不能问答。
- 全文问答单独使用 20000 tokens 输出上限。模型按页面及起止行号引用资料，服务端严格解引用；无效页码/行号或空引文拒绝保存。没有相似度匹配、猜引文或自动换模型。
- `npm test` 38 项 Node 测试和 5 项 Python 测试通过；`npm run build` 通过。真实 HTTP 上传测试已用错误论文验证返回 422，且不生成全文索引、不修改原下载状态。服务重启后已有全文问答记录仍可读取，收件箱 92 篇、未读 86 篇、每日 07:30 开启，今日收取成功。
- 本机用 PMID 43052352 的 12 页原文调用本机配置的文字模型，已返回数据规模、八项任务和结论，引用覆盖第 1/2/3/7 页，点击引用已跳转至 PDF 第 7 页；对话持久保存。桌面 1365×900 与手机 390×844 的阅读/问答布局已检查。


### 2.9.0（2026-11-20）

- 将“初始化补收历史文献”改为“初始化文献库”，每次按选定时间窗重建当前邮箱范围，不再与旧范围增量合并；窗口外论文进入归档，阅读状态、笔记、星标、全文和 PDF 保留。
- 增加 `papers.in_library` 范围标记；所有方向检索和记录核验成功后，在单个 SQLite 事务中更新范围。失败时旧邮箱不变。每日和手动收取保持增量。
- PDF 获取增加 Europe PMC 开放全文和 OpenAlex 开放版本来源，逐条核对标识符和开放标记；持久化逐来源结果和失败原因。PDF 身份接受前三页或元数据中的明确 DOI/完整标题匹配，同时校验 PDF 路径、文件头和可读页数；无身份证据的文件不会被接受。
- 增加初始化重复执行、缩小范围、保留阅读状态和每日重新纳入论文的回归测试，以及下载诊断持久化测试。
- 本机已用 30 天、IF ≥ 10、质控开启真实执行初始化：135 个 PubMed 候选、92 篇进入收件箱，范围外旧文献保留在归档；侧栏和设置页均显示 92 篇。
- 用 PMID 43052352 实测增强后的 PDF 队列，PMC 和 Europe PMC 未给出直接 PDF 后，出版社页面成功取得并校验 12 页 PDF；失败来源诊断也被保存。
- PMID 43034668 重试后仍需浏览器继续，已找到开放版本但其下载链接当前未返回 PDF；没有把这个案例计为成功。OpenAlex 单篇 DOI 接口可用，集合检索接口曾返回 429，已改用单篇接口。
- `npm test` 33 项 Node 测试与 5 项 Python 测试通过，`npm run build` 通过，Python 下载桥接脚本语法检查通过。LaunchAgent 已重启，初始化范围与本机数据库行数一致。

### 2.8.0（2026-11-20）

- 将自动相关性质控加入“初始化补收历史文献”作为可选项，覆盖历史补收与之后自动/手动收取；关闭时保留未完成队列。
- 侧栏持续显示每日自动收取状态；完成后提示成功新增篇数或失败原因，并通过 `/api/state.dailyRun` 读取最近一次每日任务。
- 每个研究方向默认收取篇数从 8 改为 10；迁移旧版默认值，同时保留用户手动设置的数量。
- 初始化区增加独立保存入口，相关性质控、历史范围、日期口径、每方向上限和自定义日期可在不启动补收的情况下保存。
- 核实 2026-11-20 07:30 自动任务成功，本次入库的 3 篇目前均在收件箱。
- 增加默认值与迁移测试；`npm test` 30 项通过，`npm run build` 通过。LaunchAgent 已重启，网页、API 状态及设置开关已验收。

### 2.7.0（2026-11-19）

- 增加逐论文、逐研究方向的相关性质控队列，使用本机配置的模型返回核心相关、边界相关或明确无关，并保存理由与原文证据。
- 对现有命中关系完成一次复核：移除明确无关标签，完全没有有效方向的 77 篇归档，保留 PMID、摘要、笔记和阅读记录。
- 收紧“医疗智能体”默认 PubMed 检索式，避免普通多药联合治疗等 `multi-agent` 语境混入。
- 设置中的“文献筛选”增加质控统计；新收文献和方向修改自动进入质控队列。
- 增加 `relevance_reviews` 数据表和迁移逻辑；29 项测试通过，构建通过。

### 2.6.0（2026-11-19）

- 修复 IF 筛选导致检索结果显示为 0 的 PubMed History 二次检索错误：后续集合查询显式携带 `usehistory=y`，并把集合阶段已确认的缺失 ISSN 传递给最终错误校验；`Wrong subquery` 警告现在会明确让任务失败，不再静默返回 0。
- 增加回归覆盖，确保 NCBI History 集合交集继续保留研究方向检索式。
- 重启本机服务并按 IF ≥ 10、PubMed 收录日期、最近 90 天、每方向最多 200 篇重新补收，新增 282 篇；收件箱当前 305 篇。
- `npm test` 28 项通过，`npm run build` 通过。

### 2.5.0（2026-11-19）

- 增加初始化历史文献补收：预设范围、自定义日期、日期口径和每方向上限。
- 每日任务改为按 PubMed 收录日期增量检索，并在漏跑时补查日期窗口。
- 补收状态、日期范围、上限和口径写入本机设置。
- 增加 PubMed 日期范围构造测试；28 项测试通过。
- 增加本开发交接文档和 README 入口。

### 2.4.0（2026-11-19）

- 首页回归邮箱式工作流，移除重复的筛选入口和装饰性信息。
- 影响因子筛选、每日推送和 API 配置集中到设置。
- 阅读页保留期刊、IF、导读、全文和 PDF 的主要入口。

### 2.3.0（2026-11-18）

- 减少过度边框和卡片，优化桌面、手机阅读布局。
- 期刊和影响因子使用轻量颜色层级。

### 2.2.0（2026-11-18）

- 使用“研邮 · Paper-mail”品牌。
- 显示 `YYYY-MM-DD` 日期。
- 增加导读模型来源、影响因子入口和设置状态。

## 14. 给其他 AI 的接手提示

接手时先执行：

```sh
cd /path/to/paper-mail
cat DEVELOPMENT.md
npm test
curl -s http://127.0.0.1:4317/api/state
```

然后检查当前用户请求对应的源码、数据库状态和 LaunchAgent 状态。不要猜测 `.env` 内容，不要重置 `data/papers.sqlite`，不要在用户未要求时自动启动初始化建库。完成修改后遵守第 12 节协议。
