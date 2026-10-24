// Built-in interview questions. Used when AI question generation is turned off
// or unavailable, and as a safety net if the AI repeats itself.
// {role} and {company} are filled in from the interview. A question that needs
// {company} is skipped when no company was entered.

type BankKey = "behavioral" | "javaDsa" | "web" | "hr" | "product" | "leadership" | "communication";

const BANK: Record<BankKey, string[]> = {
  behavioral: [
    "Tell me about yourself and why you are interested in the {role} role.",
    "Describe a project you are proud of. What was your part, and what was the outcome?",
    "Tell me about a time you faced a difficult problem. How did you approach it?",
    "Describe a time you disagreed with a teammate. How did you handle it?",
    "Tell me about a mistake you made or a deadline you missed. What did you learn?",
    "Describe a time you had to learn something new quickly. How did you do it?",
    "Tell me about a time you took initiative without being asked.",
    "How do you prioritize when several tasks are due at the same time?",
    "Tell me about feedback that was hard to hear. What did you do with it?",
    "Where do you want to be in three years, and how does the {role} role fit into that?",
  ],
  javaDsa: [
    "What is the difference between an ArrayList and a LinkedList in Java? When would you choose each?",
    "How does a HashMap work internally in Java? What happens when two keys collide?",
    "What is the difference between an abstract class and an interface in Java?",
    "Explain the four pillars of object-oriented programming using an example from a project you built.",
    "What is the difference between a stack and a queue? Give a real use case for each.",
    "What are time and space complexity? What is the complexity of binary search, and why?",
    "How would you detect a cycle in a linked list?",
    "What is the difference between == and .equals() in Java?",
    "How would you check whether a string is a palindrome? What is the time complexity of your approach?",
    "What is the difference between checked and unchecked exceptions in Java?",
    "Explain recursion. Give an example where you would prefer a loop instead.",
    "What is the difference between an array and an ArrayList, and when does that matter?",
  ],
  web: [
    "What happens, step by step, when you type a URL into a browser and press Enter?",
    "What is the difference between GET and POST requests? When would you use each?",
    "What is a REST API, and how would you design one for a simple task manager?",
    "What is the difference between SQL and NoSQL databases? Which would you choose for a project and why?",
    "How do props and state differ in a React component?",
    "Explain async/await in JavaScript and why it is useful.",
    "A page is loading slowly. How would you find out why?",
    "What is CORS, and why do browsers enforce it?",
    "How would you handle user login and keep passwords safe in a web app?",
  ],
  hr: [
    "Please introduce yourself in about a minute.",
    "What are your greatest strengths for the {role} role?",
    "What is a weakness you are working on, and how?",
    "Why should we hire you for the {role} role?",
    "Why do you want to work at {company}?",
    "How do you handle pressure or tight deadlines?",
    "Are you comfortable working in a team, and what role do you usually take?",
    "What are you looking for in your first job or internship?",
    "Do you have any questions for us?",
  ],
  product: [
    "Pick a product you use every day. What would you improve first, and why?",
    "How would you decide which feature to build next when you can only build one?",
    "Tell me about a time you used feedback from users to change something you built.",
    "How would you measure whether a new feature is successful?",
    "Describe how you would explain a product trade-off to a non-technical teammate.",
    "A feature you built is not being used. What do you do?",
  ],
  leadership: [
    "Tell me about a time you led a team or a small project. What was hard about it?",
    "How do you motivate a teammate who is falling behind?",
    "Describe a time you had to make a decision without all the information.",
    "Tell me about a time you helped someone else succeed.",
    "How do you handle a conflict between two people in your team?",
    "What does good leadership look like to you? Give an example you have seen.",
  ],
  communication: [
    "Explain a technical concept you know well to someone with no technical background.",
    "Describe a time you had to explain a bug or a problem to someone who was frustrated.",
    "How do you make sure your teammates understand your code or design decisions?",
    "Tell me about a time a miscommunication caused a problem. What did you change afterwards?",
    "How would you present the results of a project to a hiring panel in two minutes?",
    "How do you ask for help when you are stuck?",
  ],
};

function keyForTopic(topic: string): BankKey {
  const t = topic.toLowerCase();
  if (t.includes("java") || t.includes("dsa") || t.includes("algorithm") || t.includes("data structure")) return "javaDsa";
  if (t.includes("web") || t.includes("react") || t.includes("api")) return "web";
  if (t.includes("hr") || t.includes("introduction")) return "hr";
  if (t.includes("product")) return "product";
  if (t.includes("leader")) return "leadership";
  if (t.includes("communication")) return "communication";
  return "behavioral";
}

export const normalizeQuestion = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** True if the question is the same as, or nearly the same as, one already asked. */
export function isRepeatQuestion(candidate: string, asked: string[]): boolean {
  const a = normalizeQuestion(candidate);
  if (a.length < 8) return true;
  const aWords = new Set(a.split(" "));
  return asked.some((previous) => {
    const b = normalizeQuestion(previous);
    if (!b) return false;
    if (a === b) return true;
    const bWords = new Set(b.split(" "));
    let shared = 0;
    aWords.forEach((word) => { if (bWords.has(word)) shared++; });
    const similarity = shared / Math.max(aWords.size, bWords.size);
    return similarity >= 0.8;
  });
}

const fill = (template: string, role: string, company: string) =>
  template.replace(/\{role\}/g, role || "this").replace(/\{company\}/g, company);

function unasked(templates: string[], role: string, company: string, asked: string[]): string[] {
  return templates
    .filter((template) => company || !template.includes("{company}"))
    .map((template) => fill(template, role, company))
    .filter((question) => !isRepeatQuestion(question, asked));
}

const pickRandom = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

// ---------- Core CS fundamentals (placement favourites) ----------
// "basic" questions are for freshers; "deeper" ones go further and are used first for experienced levels.
type CsSubject = "dbms" | "os" | "cn" | "oop";
type Tiered = { text: string; deeper: boolean };
const tiered = (basic: string[], deeper: string[]): Tiered[] => [
  ...basic.map((text) => ({ text, deeper: false })),
  ...deeper.map((text) => ({ text, deeper: true })),
];

export const CS_BANK: Record<CsSubject, Tiered[]> = {
  dbms: tiered(
    [
      "What is a DBMS, and how is it different from storing data in plain files?",
      "What is the difference between a primary key, a candidate key and a foreign key?",
      "Explain normalization. Why do we do it, and what are 1NF, 2NF and 3NF?",
      "What are the ACID properties? Explain each one using a bank transfer as the example.",
      "What is the difference between DELETE, TRUNCATE and DROP in SQL?",
      "What is the difference between the WHERE clause and the HAVING clause?",
      "Explain the different types of SQL joins with a small example.",
      "What is an index, and how does it make queries faster? What does it cost you?",
      "What is the difference between DDL, DML and DCL commands? Give one example of each.",
    ],
    [
      "What is a transaction, and what should happen if the system crashes in the middle of one?",
      "Explain the isolation levels in a database and which problem each one prevents: dirty reads, non-repeatable reads and phantom reads.",
      "What is a deadlock in a database, and how can it be prevented or resolved?",
      "What is the difference between a clustered and a non-clustered index?",
      "What is denormalization, and when would you do it on purpose?",
      "How would you find the second highest salary in an employee table? Explain more than one approach.",
      "What is the difference between a view and a table, and why would you create a view?",
      "What is the difference between a stored procedure and a function in SQL?",
      "Explain the CAP theorem in simple words.",
    ],
  ),
  os: tiered(
    [
      "What is an operating system, and what are its main functions?",
      "What is the difference between a process and a thread?",
      "Explain the states of a process and how it moves between them.",
      "What is the difference between multiprogramming, multitasking and multithreading?",
      "What is a deadlock, and what are the four conditions needed for it to happen?",
      "Explain paging and segmentation. How are they different?",
      "What is virtual memory, and why do we need it?",
      "What is a context switch, and why is it considered expensive?",
      "What is the difference between user mode and kernel mode?",
    ],
    [
      "Compare the CPU scheduling algorithms FCFS, SJF and Round Robin. Which would you choose for an interactive system, and why?",
      "What is a semaphore, and how is a binary semaphore different from a mutex?",
      "Explain the producer-consumer problem and how you would solve it.",
      "What is thrashing, and how can an operating system avoid it?",
      "Explain the page replacement algorithms FIFO and LRU with a small example.",
      "How can a system avoid or recover from a deadlock? Explain the idea behind the Banker's algorithm.",
      "What is a race condition, and how do you prevent it?",
      "What is the difference between a system call and a normal library function?",
      "What is starvation, and how does aging help to solve it?",
    ],
  ),
  cn: tiered(
    [
      "Explain the OSI model and its seven layers in simple words.",
      "How is the OSI model different from the TCP/IP model?",
      "What is the difference between TCP and UDP? Give a use case for each.",
      "What is an IP address, and how is IPv4 different from IPv6?",
      "What is DNS, and how does it work?",
      "What is the difference between a hub, a switch and a router?",
      "How is HTTPS different from HTTP, and why does it matter?",
      "What is the difference between a MAC address and an IP address?",
      "What do the HTTP status codes 200, 301, 404 and 500 mean?",
    ],
    [
      "Explain the TCP three-way handshake. Why does it need three steps?",
      "How does TCP deliver data reliably? Talk about acknowledgements, retransmission and flow control.",
      "What is the difference between flow control and congestion control?",
      "What is subnetting, and why do networks use it?",
      "What is NAT, and why is it used?",
      "Explain ARP and DHCP. What problem does each one solve?",
      "At a high level, how does TLS make HTTPS connections secure?",
      "What is a load balancer, and how does it help a website handle more users?",
      "What is a firewall, and what kind of traffic can it block?",
    ],
  ),
  oop: tiered(
    [
      "What is the difference between a class and an object? Explain with a real-life example.",
      "What is encapsulation, and why is it useful?",
      "What is inheritance? What are its types, and why do some languages avoid multiple inheritance?",
      "What is polymorphism? Explain compile-time and run-time polymorphism.",
      "What is abstraction, and how is it different from encapsulation?",
      "What is the difference between method overloading and method overriding?",
      "What is a constructor? Can a constructor be private, and why would you want that?",
      "When would you use an abstract class, and when would you use an interface?",
      "What is the difference between static and non-static members of a class?",
    ],
    [
      "What is the diamond problem, and how do different languages solve it?",
      "What is the difference between composition and inheritance? When do you prefer composition?",
      "Explain the SOLID principles. Pick two and give an example of each.",
      "What is a virtual function, and how does dynamic dispatch work?",
      "What is the difference between a shallow copy and a deep copy of an object?",
      "What is a singleton class? How would you implement it, and what are the risks?",
      "What are design patterns? Explain one you have used, such as Factory or Observer.",
      "What are coupling and cohesion, and why do we want low coupling and high cohesion?",
      "How does memory management or garbage collection work in the language you use most?",
    ],
  ),
};

const CS_SUBJECTS = Object.keys(CS_BANK) as CsSubject[];

/** Which core-CS subjects does this topic ask for? null means it is not a core-CS topic. */
function csSubjectsFor(topic: string): CsSubject[] | null {
  const t = topic.toLowerCase();
  if (t.includes("core cs") && t.includes("mixed")) return CS_SUBJECTS;
  if (t.includes("dbms") || t.includes("database") || t.includes("sql")) return ["dbms"];
  if (t.includes("operating system")) return ["os"];
  if (t.includes("network")) return ["cn"];
  if (t.includes("oop") || t.includes("object-oriented") || t.includes("object oriented")) return ["oop"];
  return null;
}

/** Freshers get the basic tier first, senior levels the deeper tier first, junior is a mix. */
function preferredTier(level: string): "basic" | "deeper" | "any" {
  const l = level.toLowerCase();
  if (l.includes("intern") || l.includes("fresher") || l.includes("student")) return "basic";
  if (l.includes("junior")) return "any";
  return "deeper";
}

const sameQuestion = (a: string, b: string) => normalizeQuestion(a) === normalizeQuestion(b);

function pickCsQuestion(subjects: CsSubject[], level: string, asked: string[]): string | null {
  const tier = preferredTier(level);
  const open = subjects
    .map((subject) => ({
      subject,
      pool: CS_BANK[subject].filter((item) => !isRepeatQuestion(item.text, asked)),
      used: asked.filter((q) => CS_BANK[subject].some((item) => sameQuestion(item.text, q))).length,
    }))
    .filter((entry) => entry.pool.length > 0);
  if (!open.length) return null;
  // mixed mode: rotate, so the subject asked least so far comes next
  const fewest = Math.min(...open.map((entry) => entry.used));
  const chosen = pickRandom(open.filter((entry) => entry.used === fewest));
  const wanted = tier === "any" ? chosen.pool : chosen.pool.filter((item) => item.deeper === (tier === "deeper"));
  return pickRandom(wanted.length ? wanted : chosen.pool).text;
}

export function pickBankQuestion(
  interview: { topic: string; role: string; company: string | null; level?: string },
  asked: string[],
): { question: string; usedGeneralPool: boolean; startedOver: boolean } {
  const role = interview.role.trim();
  const company = (interview.company ?? "").trim();
  const level = interview.level ?? "";

  const csSubjects = csSubjectsFor(interview.topic);
  if (csSubjects) {
    const fresh = pickCsQuestion(csSubjects, level, asked);
    if (fresh) return { question: fresh, usedGeneralPool: false, startedOver: false };
    const general = unasked(BANK.behavioral, role, company, asked);
    if (general.length) return { question: pickRandom(general), usedGeneralPool: true, startedOver: false };
    // everything was asked once: start over, but not with the question just asked
    const again = pickCsQuestion(csSubjects, level, asked.slice(-1)) ?? CS_BANK[csSubjects[0]][0].text;
    return { question: again, usedGeneralPool: false, startedOver: true };
  }
  const topicKey = keyForTopic(interview.topic);

  const fromTopic = unasked(BANK[topicKey], role, company, asked);
  if (fromTopic.length) return { question: pickRandom(fromTopic), usedGeneralPool: false, startedOver: false };

  if (topicKey !== "behavioral") {
    const fromGeneral = unasked(BANK.behavioral, role, company, asked);
    if (fromGeneral.length) return { question: pickRandom(fromGeneral), usedGeneralPool: true, startedOver: false };
  }

  // Everything has been asked once: start over, but avoid the most recent question.
  const all = unasked(BANK[topicKey], role, company, asked.slice(-1));
  return { question: pickRandom(all.length ? all : unasked(BANK[topicKey], role, company, [])), usedGeneralPool: false, startedOver: true };
}
