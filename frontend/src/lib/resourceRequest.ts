/**
 * 助手消息分类：这一句该走「重排规划」还是走「纯聊天」。
 *
 * 重排整份规划代价高（阶段与每日任务会整体重建，只留一份快照），所以这里
 * 刻意保守：只有用户明确说要动路线图，或明确在要具体学习资源时才命中。
 * 判断与 UI 无关，抽出来单独测（同 `pauseRequest.ts`）。
 */

/** 改规划意图：用户直接说要动路线图 / 阶段 / 节奏。 */
const PLAN_EDIT_INTENT = /规划|阶段|每天|复习计划|路线图/;

/**
 * 资源意图：用户在要「具体学什么 / 去哪学」。
 *
 * 只认「动词 + 名词」成对出现，避免把「我上传了哪些资料」这种查询也当成重排请求。
 * 命中后走 regenerate，让资源落成每日任务上的 `resourceUrl`。
 */
const RESOURCE_REQUEST =
  /(找|推荐|有没有|想要|需要)[^。！？]{0,8}(课程|网课|视频|教材|讲义|资料|资源|网站|平台|公开课|慕课|题库|书单)|(课程|网课|教材|讲义|网站|平台|公开课|慕课)[^。！？]{0,8}(推荐|在哪|去哪里)|学习路径|学习路线|备考路线/;

/** 资源请求通常是短句；长段落多半在讲别的问题，重排整份规划代价太高。 */
const RESOURCE_REQUEST_MAX_CHARS = 60;

export function isPlanEditIntent(text: string): boolean {
  return PLAN_EDIT_INTENT.test(text.trim());
}

export function isResourceRequest(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length <= RESOURCE_REQUEST_MAX_CHARS && RESOURCE_REQUEST.test(trimmed)
  );
}
