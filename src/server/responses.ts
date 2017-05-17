import { HackModel, TeamModel, UserModel } from './models'
import { JSONApi, HackResource, HacksResource, TeamResource, UserResource } from '../resources'

export function teamModelToResourceObject(team: TeamModel) {
  return {
    type: 'teams',
    id: team.teamid,
    attributes: {
      name: team.name,
      motto: team.motto,
    },
    links: { self: `/teams/${encodeURIComponent(team.teamid)}` },
    relationships: {
      links: { self: `/teams/${encodeURIComponent(team.teamid)}/members` },
      members: { data: team.members.map(userModelToResourceIdentifierObject) },
    },
  } as TeamResource.ResourceObject
}

export function userModelToResourceObject(user: UserModel) {
  return {
    id: user.userid,
    type: 'users',
    attributes: { name: user.name },
    links: { self: `/users/${encodeURIComponent(user.userid)}` },
  } as UserResource.ResourceObject
}

export function userModelToResourceIdentifierObject(user: UserModel) {
  return {
    id: user.userid,
    type: 'users',
  } as JSONApi.ResourceIdentifierObject
}
