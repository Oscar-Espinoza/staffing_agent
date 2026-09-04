import { z } from 'zod';
import type { SourceSnapshot } from './snapshot.ts';

export type Person = {
  email: string;
  name: string;
  kantataUserId: string | null;
  salesforceUserId: string | null;
  clickupMemberId: number | null;
  title: string | null;
  weeklyCapacityHours: number | null;
  isExternal: boolean;
  /** Kantata's `active` flag; true when the source says nothing, so a missing flag never hides someone. */
  isActive: boolean;
};

const KantataUser = z.object({
  id: z.string(),
  full_name: z.string(),
  email_address: z.string(),
  job_title: z.string().nullish(),
  weekly_capacity_hours: z.number(),
  active: z.boolean().nullish(),
});
const SalesforceUser = z.object({
  Id: z.string(),
  Name: z.string(),
  Email: z.string(),
  Title: z.string().nullish(),
});
const ClickUpMember = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
});
const Email = z.string().email();

function normalizedEmail(value: string): string {
  return Email.parse(value.trim().toLowerCase());
}

function uniqueEmails<T>(records: T[], emailFor: (record: T) => string, provider: string): void {
  const emails = new Set<string>();
  for (const record of records) {
    const email = normalizedEmail(emailFor(record));
    if (emails.has(email)) throw new Error(`duplicate ${provider} email: ${email}`);
    emails.add(email);
  }
}

function emptyPerson(email: string): Person {
  return {
    email,
    name: '',
    kantataUserId: null,
    salesforceUserId: null,
    clickupMemberId: null,
    title: null,
    weeklyCapacityHours: null,
    isActive: true,
    isExternal: email.slice(email.lastIndexOf('@') + 1) !== 'gonimbly.com',
  };
}

export function joinPeople(snapshot: SourceSnapshot): Person[] {
  const kantata = snapshot.kantata.users.map((user) => KantataUser.parse(user));
  const salesforce = snapshot.salesforce.users.map((user) => SalesforceUser.parse(user));
  const clickup = snapshot.clickup.members.map((member) => ClickUpMember.parse(member));
  uniqueEmails(kantata, (user) => user.email_address, 'Kantata');
  uniqueEmails(salesforce, (user) => user.Email, 'Salesforce');
  uniqueEmails(clickup, (member) => member.email, 'ClickUp');

  const people = new Map<string, Person>();
  const personFor = (email: string) => {
    const person = people.get(email) ?? emptyPerson(email);
    people.set(email, person);
    return person;
  };

  for (const user of kantata) {
    const person = personFor(normalizedEmail(user.email_address));
    person.kantataUserId = user.id;
    person.name = user.full_name;
    person.title = user.job_title ?? null;
    person.weeklyCapacityHours = user.weekly_capacity_hours;
    person.isActive = user.active ?? true;
  }
  for (const user of salesforce) {
    const person = personFor(normalizedEmail(user.Email));
    person.salesforceUserId = user.Id;
    if (person.kantataUserId === null) {
      person.name = user.Name;
    }
    if (person.title === null) person.title = user.Title ?? null;
  }
  for (const member of clickup) {
    const person = personFor(normalizedEmail(member.email));
    person.clickupMemberId = member.id;
    if (person.kantataUserId === null && person.salesforceUserId === null) {
      person.name = member.username;
    }
  }

  return [...people.values()].sort((left, right) =>
    left.email < right.email ? -1 : left.email > right.email ? 1 : 0
  );
}
