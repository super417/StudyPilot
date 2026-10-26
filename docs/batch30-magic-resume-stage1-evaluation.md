# 第 30 批：magic-resume 集成阶段 1 技术评估

核查日期：2026-10-24。范围仅为依赖、许可证和品牌定制点；未进入集成、安装或测试。上游按 `JOYCEQL/magic-resume` 默认分支核查，GitHub 代码搜索返回的快照为 `718b20aa2c1025dd161a5b6aa2299542139f5210`。本地 `git clone --depth 1` 因 GitHub 连接未完成而中止，以下上游文件由 GitHub 只读接口取得；因此品牌清单是检索命中清单，**不能宣称完整遍历了仓库**。

## 1. 依赖审查

对照 [StudyPilot `frontend/package.json`](../frontend/package.json) 与 [上游 `package.json`](https://github.com/JOYCEQL/magic-resume/blob/main/package.json)。StudyPilot 当前工作树的 `package.json` 已有其他未提交改动，本报告仅记录当前文件内容。

| 包 | StudyPilot | magic-resume | 判断 |
| --- | --- | --- | --- |
| `react` / `react-dom` | `^18.3.1` | `^18` | 范围有交集；未验证实际安装解析 |
| `vite` | `^5.4.11` | `^7.3.1` | 主版本不相交 |
| `@vitejs/plugin-react` | `^4.3.4` | `^5.1.4` | 主版本不相交 |
| `tailwindcss` | `^3.4.17` | `^3.4.1` | 范围有交集 |
| `zustand` | `^5.0.15` | `^4.5.4` | 主版本不相交 |
| `framer-motion` | `^12.43.0` | `^11.11.10` | 主版本不相交 |
| `lucide-react` | `^0.344.0` | `^0.379.0` | `0.x` 次版本范围不相交 |
| `typescript` | `^5.6.3` | `^5` | 范围有交集 |

上游声明 `pnpm@10.3.0`，使用 `@tanstack/react-start` / `@tanstack/react-router` 与 Vite 7，见上游 [`package.json`](https://github.com/JOYCEQL/magic-resume/blob/main/package.json) 和 [`vite.config.ts`](https://github.com/JOYCEQL/magic-resume/blob/main/vite.config.ts)。StudyPilot 当前是 npm `package-lock.json`、Vite 5 单应用，未见 `frontend/pnpm-workspace.yaml`。把上游作为独立子应用可以隔离多数包版本，但路由、部署、开发端口与构建流程仍需设计和实测；当前不能认定直接放进 workspace 就能构建。

## 2. 许可证与署名

**不是 MIT，也不是纯 Apache 2.0。** 上游 [`LICENSE` 第 1–48 行](https://github.com/JOYCEQL/magic-resume/blob/main/LICENSE) 声明“Apache License 2.0 + 附加商业限制”：个人非商业用途免费；商业 SaaS、嵌入商业软件、商业运营中的改名／改 Logo／二次开发需先取得商业授权。上游 [`README.md` License and Usage Restrictions](https://github.com/JOYCEQL/magic-resume/blob/main/README.md) 也明确写有附加非商业限制。StudyPilot 被描述为非商业参赛作品，但“参赛作品整体集成并重新冠名”是否落在其允许的个人非商业范围，许可证文字没有逐项明示；阶段 2 前建议总规划核定使用场景，必要时向作者取得书面许可。

上游 [`LICENSE` Apache 2.0 第 4 节](https://github.com/JOYCEQL/magic-resume/blob/main/LICENSE) 对分发要求：附带许可证、在修改文件中显著标明改动、保留适用的版权／专利／商标／署名声明；如存在 `NOTICE`，还须保留其适用内容。第 6 节不授予原项目商标使用权。品牌替换不能把原作者署名和许可证告知一起删除。上述为仓库条款核查，不代表已取得特定集成方式的授权。

## 3. 品牌定制点

GitHub 代码搜索 `魔方简历` 命中 5 个文件，`MuJi` 命中 0 个文件；由于未能完成本地克隆，不能把 0 命中表述成全仓绝对不存在。精确位置如下：

- [`src/components/home/LandingHeader.tsx:33`](https://github.com/JOYCEQL/magic-resume/blob/main/src/components/home/LandingHeader.tsx#L33)：首页页眉中文名；`:32` 使用 `Logo`。
- [`src/components/home/Footer.tsx:12`](https://github.com/JOYCEQL/magic-resume/blob/main/src/components/home/Footer.tsx#L12)：首页页脚品牌名。
- [`src/i18n/locales/zh.json`](https://github.com/JOYCEQL/magic-resume/blob/main/src/i18n/locales/zh.json)：`3, 5, 20, 32, 37, 72, 76, 83, 84, 88, 110, 118, 170, 586` 行包含中文品牌；其中 `:170` 是后台侧栏左上角的 `dashboard.sidebar.appName`，用于显示品牌；`:76` 是版权文案，不能简单抹去原作者权利声明。
- [`scripts/generate-landing-fonts.py:11`](https://github.com/JOYCEQL/magic-resume/blob/main/scripts/generate-landing-fonts.py#L11)：字体子集生成字符串；改中文品牌后需复核生成素材。
- [`tests/mobile-workbench.browser.ts:103`](https://github.com/JOYCEQL/magic-resume/blob/main/tests/mobile-workbench.browser.ts#L103)：页眉品牌的测试断言；品牌改动时需同步更新。

上游左上角图形由 [`src/components/shared/Logo.tsx:17`](https://github.com/JOYCEQL/magic-resume/blob/main/src/components/shared/Logo.tsx#L17) 读取 [`public/logo.svg`](https://github.com/JOYCEQL/magic-resume/blob/main/public/logo.svg)。[`src/routes/__root.tsx:104–105`](https://github.com/JOYCEQL/magic-resume/blob/main/src/routes/__root.tsx#L104) 引用 `public/favicon.ico`、`public/icon.png`；[`src/app/manifest.ts:7–16`](https://github.com/JOYCEQL/magic-resume/blob/main/src/app/manifest.ts#L7) 还有 PWA 名称和图标。以上三个图片路径均已确认存在或被代码引用，但未全面枚举其他品牌图片。

如果要求英文界面也统一为 StudyPilot，仍需检查 [`src/i18n/locales/en.json`](https://github.com/JOYCEQL/magic-resume/blob/main/src/i18n/locales/en.json)、[`src/routes/__root.tsx:32`](https://github.com/JOYCEQL/magic-resume/blob/main/src/routes/__root.tsx#L32)、[`src/app/manifest.ts`](https://github.com/JOYCEQL/magic-resume/blob/main/src/app/manifest.ts) 的 `Magic Resume` 文案；`README` / `LICENSE` 中的来源与权利声明应保留，而不是全局替换。

## 4. 阶段 2 前需裁定

1. **集成形态**：上游是独立 TanStack Start 应用。普通 Git 子模块在父仓库只记录上游提交指针；如需提交改名和 Logo，须有独立可提交的修改来源（例如获许可的 fork）并明确如何更新。直接复制到 pnpm workspace 则不能自动保留原仓库的 Git 提交记录，与“保留历史”硬约束存在冲突。
2. **路由口径**：当前 StudyPilot [`frontend/src/App.tsx`](../frontend/src/App.tsx) 已有未提交的 `#/resume` 选择页及 `#/resume/practical`、`#/resume/interactive` 分流；本任务提出 `/resume` 指向引入的应用。覆盖哪个入口、是否保留选择页，须在阶段 2 明确，避免覆盖现有工作。
3. **授权与范围**：确认非商业参赛场景和所需品牌修改可使用上游代码；在本地完成全仓品牌扫描、安装解析、双应用启动与构建验证后，才能给出“全部替换”和“构建通过”的结论。

## 本轮状态

仅新增本评估报告；未改产品代码、未安装依赖、未修改 `.gitignore`、未执行 `git add` / `git commit` / 推送。`.tmp-resume` 尝试位于 StudyPilot 仓库外，克隆未成功，故没有子包内容进入仓库。**等待总规划批准阶段 2，不自行集成。**
