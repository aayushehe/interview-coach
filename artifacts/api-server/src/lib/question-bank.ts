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

export function pickBankQuestion(
  interview: { topic: string; role: string; company: string | null },
  asked: string[],
): { question: string; usedGeneralPool: boolean; startedOver: boolean } {
  const role = interview.role.trim();
  const company = (interview.company ?? "").trim();
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
