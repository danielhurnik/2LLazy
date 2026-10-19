export type JobCategory =
  | "Frontend"
  | "Backend"
  | "Fullstack"
  | "Mobile"
  | "DevOps"
  | "Data"
  | "QA"
  | "Design"
  | "Other";

export interface QueryIntent {
  category: JobCategory;
  includedTitles: string[];
  excludedTitles: string[];
  canonicalText: string;
  scrapingKeyword: string;
}

const STATIC_INTENTS: Record<string, QueryIntent> = {
  react: {
    category: "Frontend",
    includedTitles: [
      "React developer", "React frontend", "Frontend developer", "UI developer",
      "JavaScript developer", "TypeScript developer", "Next.js developer",
    ],
    excludedTitles: [
      "Backend", "Fullstack", "DevOps", "QA", "iOS", "Android", "Mobile",
      "Data engineer", "Java developer", "PHP developer", ".NET developer",
    ],
    canonicalText:
      "React.js frontend developer, JavaScript TypeScript HTML CSS, React hooks Redux Context API, " +
      "Next.js single-page applications, UI component libraries, responsive design, web interfaces, " +
      "REST API integration, cross-browser compatibility, modern frontend tooling (Vite Webpack).",
    scrapingKeyword: "React",
  },
  vue: {
    category: "Frontend",
    includedTitles: [
      "Vue developer", "Vue.js developer", "Nuxt developer", "Frontend developer",
      "UI developer", "JavaScript developer",
    ],
    excludedTitles: [
      "Backend", "Fullstack", "DevOps", "QA", "iOS", "Android", "Mobile", "Data engineer",
    ],
    canonicalText:
      "Vue.js frontend developer, Vue 3 Composition API Vuex Pinia, Nuxt.js, JavaScript TypeScript, " +
      "HTML CSS, UI components, responsive design, web application development.",
    scrapingKeyword: "Vue",
  },
  angular: {
    category: "Frontend",
    includedTitles: [
      "Angular developer", "Frontend developer", "UI developer", "TypeScript developer",
    ],
    excludedTitles: [
      "Backend", "Fullstack", "DevOps", "QA", "iOS", "Android", "Mobile", "Data engineer",
    ],
    canonicalText:
      "Angular frontend developer, Angular 17+ TypeScript RxJS NgRx, " +
      "HTML CSS component architecture, single-page applications, web UI development.",
    scrapingKeyword: "Angular",
  },
  frontend: {
    category: "Frontend",
    includedTitles: [
      "Frontend developer", "UI developer", "React developer", "Vue developer",
      "Angular developer", "JavaScript developer", "TypeScript developer",
    ],
    excludedTitles: [
      "Backend", "Fullstack", "DevOps", "QA", "iOS", "Android", "Mobile",
      "Data engineer", "Java developer", "PHP developer", ".NET developer",
    ],
    canonicalText:
      "Frontend web developer, React Vue Angular HTML CSS JavaScript TypeScript, " +
      "UI/UX implementation, responsive design, web interfaces, component libraries, " +
      "cross-browser compatibility, modern tooling.",
    scrapingKeyword: "frontend",
  },
  backend: {
    category: "Backend",
    includedTitles: [
      "Backend developer", "Server-side developer", "Node.js developer",
      "Python developer", "API developer", "Software engineer", "Java developer",
    ],
    excludedTitles: [
      "Frontend", "UI developer", "Mobile", "iOS", "Android", "DevOps only", "QA only", "Design",
    ],
    canonicalText:
      "Backend software engineer, server-side development REST APIs GraphQL, " +
      "Node.js Python Java Go, PostgreSQL MySQL MongoDB Redis, microservices, " +
      "cloud AWS GCP Azure, system design, scalability, authentication.",
    scrapingKeyword: "backend",
  },
  node: {
    category: "Backend",
    includedTitles: [
      "Node.js developer", "Backend developer", "JavaScript developer",
      "TypeScript developer", "Fullstack developer",
    ],
    excludedTitles: [
      "Frontend only", "iOS", "Android", "DevOps only", "QA only", "Java pure backend",
    ],
    canonicalText:
      "Node.js backend developer, Express Fastify NestJS, REST APIs GraphQL, " +
      "TypeScript, PostgreSQL MongoDB Redis, microservices, cloud AWS GCP.",
    scrapingKeyword: "node.js",
  },
  python: {
    category: "Backend",
    includedTitles: [
      "Python developer", "Backend developer", "Software engineer",
      "Django developer", "FastAPI developer",
    ],
    excludedTitles: [
      "Frontend only", "iOS", "Android", "DevOps only", "QA only",
    ],
    canonicalText:
      "Python backend developer, Django FastAPI Flask REST APIs, PostgreSQL Redis, " +
      "cloud AWS, microservices, data processing, scripting automation.",
    scrapingKeyword: "python",
  },
  fullstack: {
    category: "Fullstack",
    includedTitles: [
      "Fullstack developer", "Full-stack developer", "Frontend developer",
      "Backend developer", "Software engineer", "React developer", "Node.js developer",
    ],
    excludedTitles: ["DevOps only", "QA only", "iOS", "Android", "Data engineer only", "Design only"],
    canonicalText:
      "Fullstack developer, React Vue Angular frontend plus Node.js Python backend, " +
      "REST APIs GraphQL, PostgreSQL, TypeScript, cloud deployment, end-to-end feature development.",
    scrapingKeyword: "fullstack",
  },
  devops: {
    category: "DevOps",
    includedTitles: [
      "DevOps engineer", "Cloud engineer", "Platform engineer",
      "SRE", "Infrastructure engineer", "Kubernetes engineer",
    ],
    excludedTitles: [
      "Frontend", "Backend pure developer", "Mobile", "iOS", "Android", "QA only", "Data engineer",
    ],
    canonicalText:
      "DevOps engineer, Kubernetes Docker CI/CD pipelines (GitLab GitHub Actions), " +
      "AWS GCP Azure cloud infrastructure, Terraform monitoring Prometheus Grafana, " +
      "reliability engineering, IaC.",
    scrapingKeyword: "devops",
  },
  mobile: {
    category: "Mobile",
    includedTitles: [
      "Mobile developer", "React Native developer", "Flutter developer",
      "iOS developer", "Android developer",
    ],
    excludedTitles: ["Backend only", "Frontend web only", "DevOps", "QA only", "Data engineer"],
    canonicalText:
      "Mobile developer, React Native Flutter iOS Android, cross-platform development, " +
      "native modules, App Store Google Play, mobile UI, REST API integration, TypeScript Kotlin Swift.",
    scrapingKeyword: "mobile",
  },
  ios: {
    category: "Mobile",
    includedTitles: ["iOS developer", "Swift developer", "Mobile developer"],
    excludedTitles: [
      "Android", "Flutter", "React Native", "Backend", "Frontend web", "DevOps", "QA",
    ],
    canonicalText:
      "iOS developer Swift Objective-C Xcode UIKit SwiftUI, App Store distribution, " +
      "Core Data networking ARKit Apple ecosystem.",
    scrapingKeyword: "iOS",
  },
  android: {
    category: "Mobile",
    includedTitles: ["Android developer", "Kotlin developer", "Mobile developer"],
    excludedTitles: ["iOS", "Swift", "Flutter", "Backend only", "Frontend web", "DevOps", "QA"],
    canonicalText:
      "Android developer Kotlin Java Android Studio Google Play Jetpack Compose MVVM " +
      "REST API integration mobile apps.",
    scrapingKeyword: "android",
  },
  data: {
    category: "Data",
    includedTitles: [
      "Data engineer", "Data analyst", "Data scientist",
      "ML engineer", "Machine learning engineer",
    ],
    excludedTitles: [
      "Frontend", "Backend pure", "Mobile", "iOS", "Android", "DevOps only", "QA only",
    ],
    canonicalText:
      "Data engineer, ETL pipelines Apache Spark Airflow, Python SQL, data warehouses " +
      "BigQuery Snowflake, machine learning MLOps, analytics dashboards, data modelling.",
    scrapingKeyword: "data",
  },
  qa: {
    category: "QA",
    includedTitles: [
      "QA engineer", "Test engineer", "SDET", "Automation engineer", "QA analyst",
    ],
    excludedTitles: ["Frontend", "Backend", "Mobile", "DevOps", "Data engineer"],
    canonicalText:
      "QA automation engineer, Selenium Playwright Cypress, test strategy, unit integration E2E testing, " +
      "CI/CD test pipelines, bug tracking Jira, performance testing.",
    scrapingKeyword: "QA",
  },
};

function normaliseKey(query: string): string {
  return query.toLowerCase().trim().replace(/[.\s-]+/g, "");
}

const ALIAS_MAP: Record<string, string> = {
  "react.js": "react",
  reactjs: "react",
  nextjs: "react",
  "next.js": "react",
  "react native": "mobile",
  reactnative: "mobile",
  "vue.js": "vue",
  vuejs: "vue",
  "nuxt.js": "vue",
  nuxtjs: "vue",
  "node.js": "node",
  nodejs: "node",
  "full-stack": "fullstack",
  fullstackdeveloper: "fullstack",
  flutter: "mobile",
  swift: "ios",
  kotlin: "android",
  datascience: "data",
  "data science": "data",
  ml: "data",
  "machine learning": "data",
  sre: "devops",
  cloud: "devops",
  infrastructure: "devops",
  kubernetes: "devops",
  k8s: "devops",
  cypress: "qa",
  playwright: "qa",
  selenium: "qa",
  testing: "qa",
  automation: "qa",
};

const QUERY_WORD_SEPARATOR = /[^a-z0-9.#+]+/;

function intentFor(key: string): QueryIntent | undefined {
  const canonicalKey = Object.hasOwn(ALIAS_MAP, key) ? ALIAS_MAP[key] : key;
  return Object.hasOwn(STATIC_INTENTS, canonicalKey) ? STATIC_INTENTS[canonicalKey] : undefined;
}

function intentForFirstKnownWord(query: string): QueryIntent | undefined {
  const words = query.toLowerCase().split(QUERY_WORD_SEPARATOR).filter(Boolean);
  for (const word of words) {
    const intent = intentFor(word);
    if (intent) return intent;
  }
  return undefined;
}

function keywordOnlyIntent(query: string): QueryIntent {
  return {
    category: "Other",
    includedTitles: [],
    excludedTitles: [],
    canonicalText: query,
    scrapingKeyword: query,
  };
}

export function lookupIntent(query: string): QueryIntent {
  return intentFor(normaliseKey(query)) ?? intentForFirstKnownWord(query) ?? keywordOnlyIntent(query);
}
