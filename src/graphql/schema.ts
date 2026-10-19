export const typeDefs = `#graphql
  enum JobSource {
    STARTUPJOBS
    JOBSTACK
    COCUMA
    SKILLETO
    NOFLUFFJOBS
    JOBSCZ
    JOOBLE
    GLASSDOOR
  }

  enum ApplicationStatus {
    PENDING
    APPLIED
    REJECTED
    INTERVIEW
    OFFER
    FAILED
    APPLYING
    NEEDS_MANUAL
  }

  type JobPosting {
    id: ID!
    title: String!
    company: String!
    location: String
    description: String!
    sourceUrl: String!
    source: JobSource!
    salary: String
    postedAt: String
    scrapedAt: String!
    similarity: Float
    matchReasons: [String!]
    favourited: Boolean!
  }

  type Application {
    id: ID!
    job: JobPosting!
    status: ApplicationStatus!
    appliedAt: String
    interview: Interview
    createdAt: String!
  }

  type Interview {
    id: ID!
    applicationId: ID!
    scheduledAt: String!
    durationMinutes: Int!
    timezone: String!
    notes: String
  }

  type UserProfile {
    id: ID!
    name: String!
    email: String!
    phone: String
    cvPath: String
    linkedInUrl: String
    githubUrl: String
  }

  type Query {
    searchJobs(query: String!, skillLevel: String, limit: Int): [JobPosting!]!
    getFavourites: [JobPosting!]!
    getApplications(status: ApplicationStatus): [Application!]!
    getApplication(id: ID!): Application
    getInterviews(month: Int!, year: Int!): [Interview!]!
    getUserProfile: UserProfile
  }

  type Mutation {
    toggleFavourite(jobId: ID!): JobPosting!
    updateApplicationStatus(id: ID!, status: ApplicationStatus!): Application!
    scheduleInterview(
      applicationId: ID!
      scheduledAt: String!
      durationMinutes: Int
      timezone: String
      notes: String
    ): Interview!
    updateInterview(
      id: ID!
      scheduledAt: String
      durationMinutes: Int
      notes: String
    ): Interview!
    saveUserProfile(
      name: String!
      email: String!
      phone: String
      linkedInUrl: String
      githubUrl: String
    ): UserProfile!
  }
`;
