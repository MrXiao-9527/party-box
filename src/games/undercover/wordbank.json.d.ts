declare const wordbank: {
  version: number
  gameId: string
  categories: {
    id: string
    name: string
    pairs: { id: string; civilian: string; undercover: string }[]
  }[]
}
export default wordbank
