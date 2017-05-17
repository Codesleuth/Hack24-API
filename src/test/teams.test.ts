import * as assert from 'assert'
import { UsersInfoResponse } from '@slack/client'
import { MongoDB } from './utils/mongodb'
import { User } from './models/users'
import { Team } from './models/teams'
import { Challenge } from './models/challenges'
import { Attendee } from './models/attendees'
import { ApiServer } from './utils/apiserver'
import * as request from 'supertest'
import { JSONApi, TeamsResource, TeamResource, UserResource } from '../resources'
import { PusherListener } from './utils/pusherlistener'
import { SlackApi } from './utils/slackapi'
import { Random } from './utils/random'
import { Events } from './events'

describe('Teams resource', () => {

  let api: request.SuperTest<request.Test>

  before(() => {
    api = request(`http://localhost:${ApiServer.Port}`)
  })

  describe('POST new team', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let createdTeam: Team
    let statusCode: number
    let contentType: string
    let response: TeamResource.TopLevelDocument
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = MongoDB.Teams.createRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
            motto: team.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.post('/teams')
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body

      createdTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 201 Created', () => {
      assert.strictEqual(statusCode, 201)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should return the team', () => {
      assert.strictEqual(response.data.type, 'teams')
      assert.strictEqual(response.data.id, team.teamid)
      assert.strictEqual(response.data.links.self, `/teams/${team.teamid}`)
      assert.strictEqual(response.data.attributes.name, team.name)
      assert.strictEqual(response.data.attributes.motto, team.motto)
    })

    it('should include the attendee member', () => {
      assert.strictEqual(response.included.length, 1)

      const includedUser = response.included.find((o) => o.type === 'users' && o.id === attendeeUser.userid) as UserResource.ResourceObject

      assert.strictEqual(includedUser.links.self, `/users/${attendeeUser.userid}`)
      assert.strictEqual(includedUser.id, attendeeUser.userid)
      assert.strictEqual(includedUser.type, 'users')
      assert.strictEqual(includedUser.attributes.name, attendeeUser.name)
    })

    it('should create the team', () => {
      assert.ok(createdTeam, 'Team not found')
      assert.strictEqual(createdTeam.teamid, team.teamid)
      assert.strictEqual(createdTeam.name, team.name)
      assert.strictEqual(createdTeam.motto, team.motto)
    })

    it('should add the attendee as a member of the created team', () => {
      assert.strictEqual(createdTeam.members.length, 1)
      assert.ok(createdTeam.members[0].equals(attendeeUser._id), 'Team member is not the expected attendee user')
    })

    it('should send a teams_add event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 1)

      const event = pusherListener.getEvent((ev) => ev.data.teamid === team.teamid)
      assert.strictEqual(event.appId, ApiServer.PusherAppId)
      assert.strictEqual(event.contentType, 'application/json')
      assert.strictEqual(event.payload.channels[0], 'api_events')
      assert.strictEqual(event.payload.name, 'teams_add')

      const data: Events.TeamCreatedEvent = JSON.parse(event.payload.data)
      assert.strictEqual(data.name, team.name)
      assert.strictEqual(data.motto, team.motto)
      assert.strictEqual(data.members.length, 1)
      assert.strictEqual(data.members[0].userid, attendeeUser.userid)
      assert.strictEqual(data.members[0].name, attendeeUser.name)
    })

    after(() => Promise.all([
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(attendeeUser.userid),

      pusherListener.close(),
    ]))

  })

  describe('POST new team with Attendee slackid auth', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let createdTeam: Team
    let statusCode: number
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = MongoDB.Teams.createRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
            motto: team.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.post('/teams')
        .auth(attendee.slackid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status

      createdTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 201 Created', () => {
      assert.strictEqual(statusCode, 201)
    })

    it('should send a teams_add event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 1)
    })

    after(() => Promise.all([
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(attendeeUser.userid),

      pusherListener.close(),
    ]))

  })

  describe('POST new team with unknown slackid', () => {

    let attendee: Attendee
    let team: Team
    let createdTeam: Team
    let statusCode: number
    let slackApi: SlackApi
    let pusherListener: PusherListener

    before(async () => {
      attendee = MongoDB.Attendees.createRandomAttendee()
      const user = MongoDB.Users.createRandomUser()
      await MongoDB.Attendees.insertAttendee(attendee)
      team = MongoDB.Teams.createRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
            motto: team.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      slackApi = await SlackApi.Create(ApiServer.SlackApiPort, ApiServer.SlackApiBasePath)
      slackApi.UsersList = {
        ok: true,
        user: {
          id: user.userid,
          name: user.name,
          profile: {
            email: attendee.attendeeid,
          },
        },
      } as UsersInfoResponse

      const res = await api.post('/teams')
        .auth(user.userid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status

      createdTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 201 Created', () => {
      assert.strictEqual(statusCode, 201)
    })

    it('should send a teams_add event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 1)
    })

    after(() => Promise.all([
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(attendee.slackid),

      slackApi.close(),
      pusherListener.close(),
    ]))

  })

  describe('POST new team with slackid for unregistered attendee', () => {

    let attendee: Attendee
    let team: Team
    let createdTeam: Team
    let slackApi: SlackApi
    let statusCode: number
    let contentType: string
    let authenticateHeader: string
    let response: TeamResource.TopLevelDocument
    let pusherListener: PusherListener

    before(async () => {
      attendee = MongoDB.Attendees.createRandomAttendee('', true)
      const slackid = attendee.slackid
      attendee.slackid = undefined
      await MongoDB.Attendees.insertAttendee(attendee)
      team = MongoDB.Teams.createRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
            motto: team.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      slackApi = await SlackApi.Create(ApiServer.SlackApiPort, ApiServer.SlackApiBasePath)
      slackApi.UsersList = {
        ok: true,
        user: {
          id: slackid,
          profile: {
            email: 'some@unregistered.attendee.email',
          },
        },
      } as UsersInfoResponse

      const res = await api.post('/teams')
        .auth(slackid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      authenticateHeader = res.header['www-authenticate']
      response = res.body

      createdTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 401 Unauthorised', () => {
      assert.strictEqual(statusCode, 401)
    })

    it('should respond with WWW-Authenticate header for basic realm "Attendee access"', () => {
      assert.strictEqual(authenticateHeader, 'Basic realm="Attendee access", error="Bad username or password"')
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Unauthorized" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '401')
      assert.strictEqual(response.errors[0].title, 'Unauthorized')
      assert.strictEqual(response.errors[0].detail, 'Bad username or password')
    })

    it('should not send an event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 0)
    })

    after(() => Promise.all([
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),

      slackApi.close(),
      pusherListener.close(),
    ]))

  })

  describe('POST new team without motto', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let createdTeam: Team
    let statusCode: number
    let contentType: string
    let response: TeamResource.TopLevelDocument
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = MongoDB.Teams.createRandomTeam()

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
          },
        },
      }

      const res = await api.post('/teams')
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body

      createdTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 201 Created', () => {
      assert.strictEqual(statusCode, 201)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should not return the team motto', () => {
      assert.strictEqual(response.data.attributes.motto, null)
    })

    it('should create the team', () => {
      assert.ok(createdTeam, 'Team not found')
      assert.strictEqual(createdTeam.teamid, team.teamid)
      assert.strictEqual(createdTeam.name, team.name)
      assert.strictEqual(createdTeam.motto, null)
      assert.strictEqual(createdTeam.members.length, 1)
      assert.ok(createdTeam.members[0].equals(attendeeUser._id), 'Team member is not the expected attendee user')
    })

    it('should send a teams_add event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 1)

      const event = pusherListener.getEvent((ev) => ev.data.teamid === team.teamid)
      assert.strictEqual(event.appId, ApiServer.PusherAppId)
      assert.strictEqual(event.contentType, 'application/json')
      assert.strictEqual(event.payload.channels[0], 'api_events')
      assert.strictEqual(event.payload.name, 'teams_add')

      const data = JSON.parse(event.payload.data)
      assert.strictEqual(data.name, team.name)
      assert.strictEqual(data.motto, null)
      assert.strictEqual(data.members.length, 1)
      assert.strictEqual(data.members[0].userid, attendeeUser.userid)
      assert.strictEqual(data.members[0].name, attendeeUser.name)
    })

    after(() => Promise.all([
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(attendeeUser.userid),

      pusherListener.close(),
    ]))

  })

  describe('POST new team with members', () => {

    let attendee: Attendee
    let attendeeUser: User
    let otherUser: User
    let team: Team
    let createdTeam: Team
    let statusCode: number
    let contentType: string
    let response: TeamResource.TopLevelDocument
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      otherUser = await MongoDB.Users.insertRandomUser()
      team = await MongoDB.Teams.createRandomTeam()

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
            motto: team.motto,
          },
          relationships: {
            members: {
              data: [{ type: 'users', id: otherUser.userid }],
            },
          },
        },
      }

      const res = await api.post('/teams')
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body

      createdTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 201 Created', () => {
      assert.strictEqual(statusCode, 201)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should return the team resource object self link', () => {
      assert.strictEqual(response.data.type, 'teams')
      assert.strictEqual(response.data.id, team.teamid)
      assert.strictEqual(response.data.links.self, `/teams/${team.teamid}`)
      assert.strictEqual(response.data.attributes.name, team.name)
      assert.strictEqual(response.data.attributes.motto, team.motto)
    })

    it('should create the team with the expected id and name', () => {
      assert.ok(createdTeam, 'Team not found')
      assert.strictEqual(createdTeam.teamid, team.teamid)
      assert.strictEqual(createdTeam.name, team.name)
      assert.strictEqual(createdTeam.motto, team.motto)
    })

    it('should add the attendee and other user member to the created team', () => {
      assert.strictEqual(createdTeam.members.length, 2)

      const attendeeMember = createdTeam.members.find((member) => member.equals(attendeeUser._id))
      const otherUserMember = createdTeam.members.find((member) => member.equals(otherUser._id))

      assert.ok(attendeeMember, 'Attendee was not added as a team member')
      assert.ok(otherUserMember, 'Attendee was not added as a team member')
    })

    it('should send a teams_add event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 1)

      const event = pusherListener.getEvent((ev) => ev.data.teamid === team.teamid)
      assert.strictEqual(event.appId, ApiServer.PusherAppId)
      assert.strictEqual(event.contentType, 'application/json')
      assert.strictEqual(event.payload.channels[0], 'api_events')
      assert.strictEqual(event.payload.name, 'teams_add')

      const data: Events.TeamCreatedEvent = JSON.parse(event.payload.data)
      assert.strictEqual(data.name, team.name)
      assert.strictEqual(data.motto, team.motto)

      assert.strictEqual(data.members.length, 2)

      const attendeeMember = data.members.find((member) => member.userid === attendeeUser.userid)
      const otherUserMember = data.members.find((member) => member.userid === otherUser.userid)

      assert.strictEqual(attendeeMember.name, attendeeUser.name)
      assert.strictEqual(otherUserMember.name, otherUser.name)
    })

    after(() => Promise.all([
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(attendeeUser.userid),
      MongoDB.Users.removeByUserId(otherUser.userid),
      MongoDB.Teams.removeByTeamId(team.teamid),

      pusherListener.close(),
    ]))

  })

  describe('POST team which already exists', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let statusCode: number
    let contentType: string
    let response: JSONApi.TopLevelDocument
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
            motto: team.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.post('/teams')
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body

      await pusherListener.waitForEvent()
    })

    it('should respond with status code 409 Conflict', () => {
      assert.strictEqual(statusCode, 409)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should return an error with status code 409 and the expected title', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '409')
      assert.strictEqual(response.errors[0].title, 'Conflict')
      assert.strictEqual(response.errors[0].detail, 'Team already exists')
    })

    it('should not send an event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 0)
    })

    after(() => Promise.all([
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Users.removeByUserId(attendeeUser.userid),

      pusherListener.close(),
    ]))

  })

  describe('POST team with incorrect authentication', () => {

    let createdTeam: Team
    let statusCode: number
    let contentType: string
    let authenticateHeader: string
    let response: JSONApi.TopLevelDocument
    let pusherListener: PusherListener

    before(async () => {
      const team = MongoDB.Teams.createRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          attributes: {
            name: team.name,
            motto: team.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.post('/teams')
        .auth('not@user.com', ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      authenticateHeader = res.header['www-authenticate']
      response = res.body

      createdTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 401 Unauthorised', () => {
      assert.strictEqual(statusCode, 401)
    })

    it('should respond with WWW-Authenticate header for basic realm "Attendee access"', () => {
      assert.strictEqual(authenticateHeader, 'Basic realm="Attendee access", error="Bad username or password"')
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Unauthorized" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '401')
      assert.strictEqual(response.errors[0].title, 'Unauthorized')
      assert.strictEqual(response.errors[0].detail, 'Bad username or password')
    })

    it('should not create the team document', () => {
      assert.strictEqual(createdTeam, null)
    })

    it('should not send an event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 0)
    })

    after(() => pusherListener.close())

  })

  describe('OPTIONS teams', () => {

    let origin: string
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlAllowMethods: string
    let accessControlAllowHeaders: string
    let accessControlExposeHeaders: string
    let accessControlMaxAge: string
    let response: string

    before(async () => {
      origin = Random.str()

      const res = await api.options('/teams')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlAllowMethods = res.header['access-control-allow-methods']
      accessControlAllowHeaders = res.header['access-control-allow-headers']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      accessControlMaxAge = res.header['access-control-max-age']
      response = res.text
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should return no content type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.strictEqual(accessControlAllowMethods, 'GET')
      assert.deepEqual(accessControlAllowHeaders.split(','), ['Accept', 'Authorization', 'Content-Type', 'If-None-Match'])
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
      assert.strictEqual(accessControlMaxAge, '86400')
    })

    it('should return no body', () => {
      assert.strictEqual(response, '')
    })

  })

  describe('GET teams', () => {

    let origin: string
    let firstUser: User
    let secondUser: User
    let thirdUser: User
    let firstTeam: Team
    let secondTeam: Team
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: TeamsResource.TopLevelDocument

    before(async () => {
      await MongoDB.Teams.removeAll()

      origin = Random.str()

      firstUser = await MongoDB.Users.insertRandomUser('A')
      secondUser = await MongoDB.Users.insertRandomUser('B')
      thirdUser = await MongoDB.Users.insertRandomUser('C')

      firstTeam = MongoDB.Teams.createRandomTeam('A')
      firstTeam.members = [firstUser._id]
      delete firstTeam.motto
      await MongoDB.Teams.insertTeam(firstTeam)

      secondTeam = await MongoDB.Teams.createRandomTeam('B')
      secondTeam.members = [secondUser._id, thirdUser._id]
      await MongoDB.Teams.insertTeam(secondTeam)

      const res = await api.get('/teams')
        .set('Origin', origin)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 200 OK', () => {
      assert.strictEqual(statusCode, 200)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return the teams resource object self link', () => {
      assert.strictEqual(response.links.self, '/teams')
    })

    it('should return the first team', () => {
      const teamResponse = response.data[0]

      assert.strictEqual(teamResponse.type, 'teams')
      assert.strictEqual(teamResponse.id, firstTeam.teamid)
      assert.strictEqual(teamResponse.attributes.name, firstTeam.name)
      assert.strictEqual(teamResponse.attributes.motto, null)

      assert.strictEqual(teamResponse.relationships.members.data.length, 1)
      assert.strictEqual(teamResponse.relationships.members.data[0].type, 'users')
      assert.strictEqual(teamResponse.relationships.members.data[0].id, firstUser.userid)
    })

    it('should return the second team', () => {
      const teamResponse = response.data[1]

      assert.strictEqual(teamResponse.type, 'teams')
      assert.strictEqual(teamResponse.id, secondTeam.teamid)
      assert.strictEqual(teamResponse.attributes.name, secondTeam.name)
      assert.strictEqual(teamResponse.attributes.motto, secondTeam.motto)

      assert.strictEqual(teamResponse.relationships.members.data.length, 2)
      assert.strictEqual(teamResponse.relationships.members.data[0].type, 'users')
      assert.strictEqual(teamResponse.relationships.members.data[0].id, secondUser.userid)

      assert.strictEqual(teamResponse.relationships.members.data[1].type, 'users')
      assert.strictEqual(teamResponse.relationships.members.data[1].id, thirdUser.userid)
    })

    it('should include the related members', () => {
      assert.strictEqual(response.included.length, 3)
      assert.strictEqual(response.included.filter((obj) => obj.type === 'users').length, 3)
    })

    it('should include each expected users', () => {
      const users = response.included.filter((doc) => doc.type === 'users') as UserResource.ResourceObject[]

      assert.strictEqual(users[0].links.self, `/users/${firstUser.userid}`)
      assert.strictEqual(users[0].id, firstUser.userid)
      assert.strictEqual(users[0].attributes.name, firstUser.name)

      assert.strictEqual(users[1].links.self, `/users/${secondUser.userid}`)
      assert.strictEqual(users[1].id, secondUser.userid)
      assert.strictEqual(users[1].attributes.name, secondUser.name)

      assert.strictEqual(users[2].links.self, `/users/${thirdUser.userid}`)
      assert.strictEqual(users[2].id, thirdUser.userid)
      assert.strictEqual(users[2].attributes.name, thirdUser.name)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(firstUser.userid),
      MongoDB.Users.removeByUserId(secondUser.userid),
      MongoDB.Users.removeByUserId(thirdUser.userid),

      MongoDB.Teams.removeByTeamId(firstTeam.teamid),
      MongoDB.Teams.removeByTeamId(secondTeam.teamid),
    ]))

  })

  describe('OPTIONS teams by slug (teamid)', () => {

    let origin: string
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlAllowMethods: string
    let accessControlAllowHeaders: string
    let accessControlExposeHeaders: string
    let accessControlMaxAge: string
    let response: string

    before(async () => {
      origin = Random.str()

      const team = MongoDB.Teams.createRandomTeam()

      const res = await api.options(`/teams/${team.teamid}`)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlAllowMethods = res.header['access-control-allow-methods']
      accessControlAllowHeaders = res.header['access-control-allow-headers']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      accessControlMaxAge = res.header['access-control-max-age']
      response = res.text
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should return no content type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.strictEqual(accessControlAllowMethods, 'GET')
      assert.deepEqual(accessControlAllowHeaders.split(','), ['Accept', 'Authorization', 'Content-Type', 'If-None-Match'])
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
      assert.strictEqual(accessControlMaxAge, '86400')
    })

    it('should return no body', () => {
      assert.strictEqual(response, '')
    })

  })

  describe('GET team by slug (teamid)', () => {

    let origin: string
    let challenge: Challenge
    let firstUser: User
    let secondUser: User
    let team: Team
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: TeamResource.TopLevelDocument

    before(async () => {
      origin = Random.str()

      challenge = await MongoDB.Challenges.insertRandomChallenge()

      firstUser = await MongoDB.Users.insertRandomUser('A')
      secondUser = await MongoDB.Users.insertRandomUser('B')

      team = MongoDB.Teams.createRandomTeam()
      team.members = [firstUser._id, secondUser._id]
      await MongoDB.Teams.insertTeam(team)

      const res = await api.get(`/teams/${team.teamid}`)
        .set('Origin', origin)
        .set('Accept', 'application/json')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 200 OK', () => {
      assert.strictEqual(statusCode, 200)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return the team resource object self link', () => {
      assert.strictEqual(response.links.self, `/teams/${team.teamid}`)
    })

    it('should return the team primary data', () => {
      assert.strictEqual(response.data.type, 'teams')
      assert.strictEqual(response.data.id, team.teamid)
      assert.strictEqual(response.data.attributes.name, team.name)
      assert.strictEqual(response.data.attributes.motto, team.motto)
    })

    it('should return the user relationships', () => {
      const users = response.data.relationships.members.data

      assert.strictEqual(users[0].type, 'users')
      assert.strictEqual(users[0].id, firstUser.userid)
      assert.strictEqual(users[1].type, 'users')
      assert.strictEqual(users[1].id, secondUser.userid)
    })

    it('should include the related members, entries and challenges', () => {
      assert.strictEqual(response.included.length, 2)

      const users = response.included.filter((o) => o.type === 'users') as UserResource.ResourceObject[]
      assert.strictEqual(users.length, 2)
      assert.strictEqual(users[0].links.self, `/users/${firstUser.userid}`)
      assert.strictEqual(users[0].id, firstUser.userid)
      assert.strictEqual(users[0].attributes.name, firstUser.name)
      assert.strictEqual(users[1].links.self, `/users/${secondUser.userid}`)
      assert.strictEqual(users[1].id, secondUser.userid)
      assert.strictEqual(users[1].attributes.name, secondUser.name)
    })

    after(() => Promise.all([
      MongoDB.Challenges.removeByChallengeId(challenge.challengeid),
      MongoDB.Users.removeByUserId(firstUser.userid),
      MongoDB.Users.removeByUserId(secondUser.userid),
      MongoDB.Teams.removeByTeamId(team.teamid),
    ]))

  })

  describe('GET team by slug (teamid) without a motto', () => {

    let origin: string
    let firstUser: User
    let secondUser: User
    let team: Team
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: TeamResource.TopLevelDocument

    before(async () => {
      origin = Random.str()

      firstUser = await MongoDB.Users.insertRandomUser('A')
      secondUser = await MongoDB.Users.insertRandomUser('B')

      team = MongoDB.Teams.createRandomTeam()
      team.members = [firstUser._id, secondUser._id]
      delete team.motto

      await MongoDB.Teams.insertTeam(team)

      const res = await api.get(`/teams/${team.teamid}`)
        .set('Origin', origin)
        .set('Accept', 'application/json')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 200 OK', () => {
      assert.strictEqual(statusCode, 200)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return the team resource object self link', () => {
      assert.strictEqual(response.links.self, `/teams/${team.teamid}`)
    })

    it('should return the team primary data', () => {
      assert.strictEqual(response.data.type, 'teams')
      assert.strictEqual(response.data.id, team.teamid)
      assert.strictEqual(response.data.attributes.name, team.name)
      assert.strictEqual(response.data.attributes.motto, null)
    })

    it('should return the user relationships', () => {
      assert.strictEqual(response.data.relationships.members.data[0].type, 'users')
      assert.strictEqual(response.data.relationships.members.data[0].id, firstUser.userid)
      assert.strictEqual(response.data.relationships.members.data[1].type, 'users')
      assert.strictEqual(response.data.relationships.members.data[1].id, secondUser.userid)
    })

    it('should include the related members and entries', () => {
      assert.strictEqual(response.included.length, 2)

      const users = response.included.filter((o) => o.type === 'users') as UserResource.ResourceObject[]
      assert.strictEqual(users.length, 2)
      assert.strictEqual(users[0].links.self, `/users/${firstUser.userid}`)
      assert.strictEqual(users[0].id, firstUser.userid)
      assert.strictEqual(users[0].attributes.name, firstUser.name)
      assert.strictEqual(users[1].links.self, `/users/${secondUser.userid}`)
      assert.strictEqual(users[1].id, secondUser.userid)
      assert.strictEqual(users[1].attributes.name, secondUser.name)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(firstUser.userid),
      MongoDB.Users.removeByUserId(secondUser.userid),
      MongoDB.Teams.removeByTeamId(team.teamid),
    ]))

  })

  describe('GET team by slug (teamid) which does not exist', () => {

    let statusCode: number
    let contentType: string
    let response: TeamResource.TopLevelDocument

    before(async () => {
      const res = await api.get(`/teams/does not exist`)
        .set('Accept', 'application/json')
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body
    })

    it('should respond with status code 404 Not Found', () => {
      assert.strictEqual(statusCode, 404)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should respond with the expected "Team not found" error', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '404')
      assert.strictEqual(response.errors[0].title, 'Not Found')
      assert.strictEqual(response.errors[0].detail, 'Team not found')
    })
  })

  describe('PATCH existing team with name', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let modifiedTeam: Team
    let statusCode: number
    let contentType: string
    let body: string
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam()
      const newTeam = MongoDB.Teams.createRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          id: team.teamid,
          attributes: {
            name: newTeam.name,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.patch(`/teams/${team.teamid}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      body = res.text

      modifiedTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should not return a content-type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should not return a response body', () => {
      assert.strictEqual(body, '')
    })

    it('should not modify the team', () => {
      assert.strictEqual(modifiedTeam.teamid, team.teamid)
      assert.strictEqual(modifiedTeam.name, team.name)
      assert.strictEqual(modifiedTeam.motto, team.motto)
      assert.strictEqual(modifiedTeam.members.length, 0)
    })

    it('should not send an event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 0)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(attendeeUser.userid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Teams.removeByTeamId(team.teamid),

      pusherListener.close(),
    ]))

  })

  describe('PATCH existing team without any attributes', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let modifiedTeam: Team
    let statusCode: number
    let contentType: string
    let body: string
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          id: team.teamid,
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.patch(`/teams/${team.teamid}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      body = res.text

      modifiedTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should not return a content-type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should not return a response body', () => {
      assert.strictEqual(body, '')
    })

    it('should not modify the team', () => {
      assert.strictEqual(modifiedTeam.teamid, team.teamid)
      assert.strictEqual(modifiedTeam.name, team.name)
      assert.strictEqual(modifiedTeam.motto, team.motto)
      assert.strictEqual(modifiedTeam.members.length, 0)
    })

    it('should not send an event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 0)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(attendeeUser.userid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Teams.removeByTeamId(team.teamid),

      pusherListener.close(),
    ]))

  })

  describe('PATCH existing team with motto', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let newTeam: Team
    let modifiedTeam: Team
    let statusCode: number
    let contentType: string
    let body: string
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam()
      newTeam = MongoDB.Teams.createRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          id: team.teamid,
          attributes: {
            motto: newTeam.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.patch(`/teams/${team.teamid}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      body = res.text

      modifiedTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should not return a content-type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should not return a response body', () => {
      assert.strictEqual(body, '')
    })

    it('should modify the team motto', () => {
      assert.strictEqual(modifiedTeam.teamid, team.teamid)
      assert.strictEqual(modifiedTeam.name, team.name)
      assert.strictEqual(modifiedTeam.motto, newTeam.motto)
      assert.strictEqual(modifiedTeam.members.length, 0)
    })

    it('should send a teams_update_motto event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 1)

      const event = pusherListener.getEvent((ev) => ev.data.teamid === team.teamid)
      assert.strictEqual(event.appId, ApiServer.PusherAppId)
      assert.strictEqual(event.contentType, 'application/json')
      assert.strictEqual(event.payload.channels[0], 'api_events')
      assert.strictEqual(event.payload.name, 'teams_update_motto')

      const data = JSON.parse(event.payload.data)
      assert.strictEqual(data.name, team.name)
      assert.strictEqual(data.motto, newTeam.motto)
      assert.strictEqual(data.members.length, 0)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(attendeeUser.userid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Teams.removeByTeamId(team.teamid),

      pusherListener.close(),
    ]))

  })

  describe('PATCH existing team with same motto', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let modifiedTeam: Team
    let statusCode: number
    let contentType: string
    let body: string
    let pusherListener: PusherListener

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam()

      const teamRequest: TeamResource.TopLevelDocument = {
        data: {
          type: 'teams',
          id: team.teamid,
          attributes: {
            motto: team.motto,
          },
        },
      }

      pusherListener = await PusherListener.Create(ApiServer.PusherPort)

      const res = await api.patch(`/teams/${team.teamid}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send(teamRequest)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      body = res.text

      modifiedTeam = await MongoDB.Teams.findbyTeamId(team.teamid)
      await pusherListener.waitForEvent()
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should not return a content-type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should not return a response body', () => {
      assert.strictEqual(body, '')
    })

    it('should not modify the team motto', () => {
      assert.strictEqual(modifiedTeam.teamid, team.teamid)
      assert.strictEqual(modifiedTeam.name, team.name)
      assert.strictEqual(modifiedTeam.motto, team.motto)
      assert.strictEqual(modifiedTeam.members.length, 0)
    })

    it('should not send an event to Pusher', () => {
      assert.strictEqual(pusherListener.events.length, 0)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(attendeeUser.userid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Teams.removeByTeamId(team.teamid),

      pusherListener.close(),
    ]))

  })

  describe('GET teams by filter', () => {

    let origin: string
    let firstTeam: Team
    let secondTeam: Team
    let thirdTeam: Team
    let statusCode: number
    let contentType: string
    let accessControlAllowOrigin: string
    let accessControlExposeHeaders: string
    let response: TeamsResource.TopLevelDocument

    before(async () => {
      await MongoDB.Teams.removeAll()

      origin = Random.str()

      firstTeam = await MongoDB.Teams.insertRandomTeam([], 'ABCD')
      secondTeam = await MongoDB.Teams.insertRandomTeam([], 'ABEF')
      thirdTeam = await MongoDB.Teams.insertRandomTeam([], 'ABCE')

      const res = await api.get('/teams?filter[name]=ABC')
        .set('Origin', origin)
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      accessControlAllowOrigin = res.header['access-control-allow-origin']
      accessControlExposeHeaders = res.header['access-control-expose-headers']
      response = res.body
    })

    it('should respond with status code 200 OK', () => {
      assert.strictEqual(statusCode, 200)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should allow the origin access to the resource with GET', () => {
      assert.strictEqual(accessControlAllowOrigin, origin)
      assert.deepEqual(accessControlExposeHeaders.split(','), ['WWW-Authenticate', 'Server-Authorization'])
    })

    it('should return the teams resource object self link', () => {
      assert.strictEqual(response.links.self, '/teams')
    })

    it('should return two teams', () => {
      assert.strictEqual(response.data.length, 2)
    })

    it('should return the first team', () => {
      const teamResponse = response.data[0]

      assert.strictEqual(teamResponse.type, 'teams')
      assert.strictEqual(teamResponse.id, firstTeam.teamid)
      assert.strictEqual(teamResponse.attributes.name, firstTeam.name)
      assert.strictEqual(teamResponse.attributes.motto, firstTeam.motto)
    })

    it('should return the third team', () => {
      const teamResponse = response.data[1]

      assert.strictEqual(teamResponse.type, 'teams')
      assert.strictEqual(teamResponse.id, thirdTeam.teamid)
      assert.strictEqual(teamResponse.attributes.name, thirdTeam.name)
      assert.strictEqual(teamResponse.attributes.motto, thirdTeam.motto)
    })

    after(() => Promise.all([
      MongoDB.Teams.removeByTeamId(firstTeam.teamid),
      MongoDB.Teams.removeByTeamId(secondTeam.teamid),
      MongoDB.Teams.removeByTeamId(thirdTeam.teamid),
    ]))

  })

  describe('DELETE team when no members', () => {

    let attendee: Attendee
    let attendeeUser: User
    let team: Team
    let statusCode: number
    let contentType: string
    let body: string

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      team = await MongoDB.Teams.insertRandomTeam([], 'ABCD')

      const res = await api.delete(`/teams/${team.teamid}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send()
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      body = res.text
    })

    it('should respond with status code 204 No Content', () => {
      assert.strictEqual(statusCode, 204)
    })

    it('should not return a content-type', () => {
      assert.strictEqual(contentType, undefined)
    })

    it('should not return a response body', () => {
      assert.strictEqual(body, '')
    })

    it('should delete the team', async () => {
      const result = await MongoDB.Teams.findbyTeamId(team.teamid)
      assert.strictEqual(result, null)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(attendeeUser.userid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
    ]))

  })

  describe('DELETE team when members', () => {

    let attendee: Attendee
    let attendeeUser: User
    let otherUser: User
    let team: Team
    let statusCode: number
    let contentType: string
    let response: JSONApi.TopLevelDocument

    before(async () => {
      ({ attendee, user: attendeeUser } = await MongoDB.createAttendeeAndUser())
      otherUser = await MongoDB.Users.insertRandomUser('A')
      team = await MongoDB.Teams.insertRandomTeam([otherUser._id], 'ABCD')

      const res = await api.delete(`/teams/${team.teamid}`)
        .auth(attendee.attendeeid, ApiServer.HackbotPassword)
        .type('application/vnd.api+json')
        .send()
        .end()

      statusCode = res.status
      contentType = res.header['content-type']
      response = res.body
    })

    it('should respond with status code 400 Bad Request', () => {
      assert.strictEqual(statusCode, 400)
    })

    it('should return application/vnd.api+json content with charset utf-8', () => {
      assert.strictEqual(contentType, 'application/vnd.api+json; charset=utf-8')
    })

    it('should return an error with status code 400 and the expected title', () => {
      assert.strictEqual(response.errors.length, 1)
      assert.strictEqual(response.errors[0].status, '400')
      assert.strictEqual(response.errors[0].title, 'Bad Request')
      assert.strictEqual(response.errors[0].detail, 'Only empty teams can be deleted')
    })

    it('should not delete the team', async () => {
      const result = await MongoDB.Teams.findbyTeamId(team.teamid)
      assert.notStrictEqual(result, null)
    })

    after(() => Promise.all([
      MongoDB.Users.removeByUserId(attendeeUser.userid),
      MongoDB.Attendees.removeByAttendeeId(attendee.attendeeid),
      MongoDB.Teams.removeByTeamId(team.teamid),
      MongoDB.Users.removeByUserId(otherUser.userid),
    ]))

  })

})
