import { Request, IReply } from 'hapi'
import { HackModel } from '../../models'
import { HackResource, HacksResource, TeamResource, UserResource } from '../../../resources'
import { createEscapedRegex } from '../../utils'
import { teamModelToResourceObject, userModelToResourceObject } from '../../responses'

export default async function handler(req: Request, reply: IReply) {
  const query: { name?: RegExp } = {}

  if (req.query['filter[name]']) {
    query.name = createEscapedRegex(req.query['filter[name]'])
  }

  const hacks = await HackModel
    .find(query)
    .select('hackid name team')
    .sort({ hackid: 1 })
    .populate({
      path: 'team',
      select: 'teamid name motto members',
      populate: {
        path: 'members',
        select: 'userid name',
      },
    })
    .exec()

  const hackResponses = hacks.map((hack): HackResource.ResourceObject => ({
    links: { self: `/hacks/${encodeURIComponent(hack.hackid)}` },
    type: 'hacks',
    id: hack.hackid,
    attributes: {
      name: hack.name,
    },
    relationships: {
      team: hack.team && {
        data: { id: hack.team.teamid, type: 'teams' },
      },
    },
  }))

  const includedTeamIds: string[] = []
  const includedTeams: TeamResource.ResourceObject[] = []
  const includedUserIds: string[] = []
  const includedUsers: UserResource.ResourceObject[] = []

  hacks
    .forEach((hack) => {
      const team = hack.team
      if (!team) {
        return
      }
      if (includedTeamIds.indexOf(team.teamid) === -1) {
        includedTeamIds.push(team.teamid)
        includedTeams.push(teamModelToResourceObject(team))
      }

      team.members.forEach((member) => {
        if (includedUserIds.indexOf(member.userid) === -1) {
          includedUserIds.push(member.userid)
          includedUsers.push(userModelToResourceObject(member))
        }
      })
    })

  const hacksResponse = {
    links: { self: `/hacks` },
    data: hackResponses,
    included: [...includedTeams, ...includedUsers],
  } as HacksResource.TopLevelDocument

  reply(hacksResponse)
}
