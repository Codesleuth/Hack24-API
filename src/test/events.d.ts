export declare module Events {

  export interface TeamCreatedEvent {
    teamid: string
    name: string
    motto: string
    members: {
      userid: string
      name: string
    }[]
  }

}
