import { Request, IReply } from 'hapi'
import * as Boom from 'boom'
import { TeamModel } from '../../models'
import { TeamResource, UserResource } from '../../../resources'

export default async function handler(req: Request, reply: IReply) {
  const teamId = req.params.teamId

  const team = await TeamModel
    .findOne({ teamid: teamId }, 'teamid name motto members entries')
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

  if (team === null) {
    reply(Boom.notFound('Team not found'))
    return
  }

  const includedUsers = team.members.map((user): UserResource.ResourceObject => ({
    links: { self: `/users/${user.userid}` },
    type: 'users',
    id: user.userid,
    attributes: { name: user.name },
  }))

  const result: TeamResource.TopLevelDocument = {
    links: { self: `/teams/${encodeURIComponent(team.teamid)}` },
    data: {
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
    },
    included: [...includedUsers],
  }

  reply(result)
}
