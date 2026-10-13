/**
 * 助手消息分类。是否重排由 `decideChatRoute` 决定。
 * 这里只识别「明确在改当前计划」。单独出现规划、每天，或只是要资料，都不算。
 */

const PLAN_NOUN = /规划|计划|阶段|每天|每日|路线图|完成标准/;
const PLAN_CHANGE = /改成|改为|调成|调整|改一下|修改/;
const NOT_AN_EDIT = /[?？]|吗|为什么|怎么|是否|是不是|解释|说明一下|什么意思|不要|别改|不改|不用改|先不/;

/**
 * 资源说法仍可识别，但不再单独打开重排。要不要改计划看 `isPlanEditIntent`。
 */
const RESOURCE_REQUEST =
  /(找|推荐|有没有|想要|需要)[^。！？]{0,8}(课程|网课|视频|教材|讲义|资料|资源|网站|平台|公开课|慕课|题库|书单)|(课程|网课|教材|讲义|网站|平台|公开课|慕课)[^。！？]{0,8}(推荐|在哪|去哪里)|学习路径|学习路线|备考路线/;

/** 长段落不再标成资源请求。这个结果本身不会打开重排。 */
const RESOURCE_REQUEST_MAX_CHARS = 60;

export function isPlanEditIntent(text: string): boolean {
  const trimmed = text.trim();
  if (NOT_AN_EDIT.test(trimmed)) return false;
  return PLAN_NOUN.test(trimmed) && PLAN_CHANGE.test(trimmed);
}

export function isResourceRequest(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length <= RESOURCE_REQUEST_MAX_CHARS && RESOURCE_REQUEST.test(trimmed)
  );
}
