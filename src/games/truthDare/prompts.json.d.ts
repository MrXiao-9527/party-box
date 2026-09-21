declare const prompts: {
  version: number
  gameId: string
  prompts: {
    id: string
    type: 'truth' | 'dare'
    text: string
    category?: string
  }[]
}
export default prompts
