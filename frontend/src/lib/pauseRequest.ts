/** 整句就是暂停指令才算。带具体问题的句子仍交给助手。 */
const PAUSE_REQUEST =
  /^(?:请)?(?:暂停一下|先暂停|暂停|停一下|先停|停下|停止|别说了|pause|stop)[。.!！]?$/i;

export function isPauseRequest(text: string): boolean {
  return PAUSE_REQUEST.test(text.trim());
}
