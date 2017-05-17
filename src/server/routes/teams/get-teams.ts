import { Request, IReply } from 'hapi'
import { TeamModel } from '../../models'
import { TeamResource, TeamsResource, JSONApi } from '../../../resources'
import { createEscapedRegex } from '../../utils'
import { userModelToResourceObject } from '../../responses'

export default async function handler(req: Request, reply: IReply) {
  const query: any = {}

  if (req.query['filter[name]']) {
    query.name = createEscapedRegex(req.query['filter[name]'])
  }

  const teams = await TeamModel
    .find(query, 'teamid name motto members entries')
    .sort({ teamid: 1 })
    .populate({
      path: 'members',
      select: 'userid name',
    })
    .populate({
      path: 'entries',
      select: 'hackid name challenges',
      populate: {
        path: 'challenges',
        select: 'challengeid name',
      },
    })
    .exec()

  const teamResponses = teams.map((team): TeamResource.ResourceObject => ({
    links: { self: `/teams/${encodeURIComponent(team.teamid)}` },
    type: 'teams',
    id: team.teamid,
    attributes: {
      name: team.name,
      motto: team.motto || null,
    },
    relationships: {
      members: {
        links: { self: `/teams/${encodeURIComponent(team.teamid)}/members` },
        data: team.members.map((member) => ({ type: 'users', id: member.userid })),
      },
    },
  }))

  const included: JSONApi.ResourceObject[] = [].concat(...teams.map((team) => (
    team.members.map(userModelToResourceObject)
  )))

  const teamsResponse: TeamsResource.TopLevelDocument = {
    links: { self: `/teams` },
    data: teamResponses,
    included,
  }

  reply(teamsResponse)
}
