/** mammoth 浏览器构建无独立类型声明，复用主包的结果结构，仅声明本工具用到的接口。 */
declare module 'mammoth/mammoth.browser' {
  export interface MammothResult {
    value: string
    messages: unknown[]
  }
  export interface MammothInput {
    arrayBuffer: ArrayBuffer
  }
  const mammoth: {
    extractRawText(input: MammothInput): Promise<MammothResult>
  }
  export default mammoth
}
