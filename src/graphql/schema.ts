export const typeDefs = `#graphql
  enum ApplicationStatus {
    PENDING
    APPLIED
    REJECTED
    INTERVIEW
    FAILED
  }

  type JobPosting {
    id: ID!
    title: String!
    company: String!
    location: String
    description: String!
    sourceUrl: String!
    source: String!
    salary: String
    postedAt: String
    scrapedAt: String!
    country: String
    """Lexical relevance of the posting to the query, 0–1."""
    score: Float
    """@deprecated Legacy name for score; kept so older clients keep working."""
    similarity: Float
    favourited: Boolean!
  }

  type Application {
    id: ID!
    job: JobPosting!
    status: ApplicationStatus!
    appliedAt: String
    errorMessage: String
    coverLetter: CoverLetter
    interview: Interview
    createdAt: String!
  }

  type CoverLetter {
    id: ID!
    jobId: ID!
    content: String!
    generatedFromTemplate: Boolean!
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

  type ScraperHealth {
    ok: Boolean!
    """True when Playwright is enabled, which unlocks the JavaScript-heavy boards."""
    playwrightEnabled: Boolean!
    """Optional integrations that are configured, for example Adzuna."""
    optionalIntegrations: [String!]!
  }

  type Query {
    searchJobs(query: String!, skillLevel: String, limit: Int): [JobPosting!]!
    getFavourites: [JobPosting!]!
    getApplications(status: ApplicationStatus): [Application!]!
    getApplication(id: ID!): Application
    getInterviews(month: Int!, year: Int!): [Interview!]!
    getCoverLetter(id: ID!): CoverLetter
    getUserProfile: UserProfile
    scraperHealth: ScraperHealth!
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
    generateCoverLetter(jobId: ID!, useSavedCV: Boolean): CoverLetter!
    deleteCoverLetter(id: ID!): Boolean!
    saveUserProfile(
      name: String!
      email: String!
      phone: String
      linkedInUrl: String
      githubUrl: String
    ): UserProfile!
  }
`;
