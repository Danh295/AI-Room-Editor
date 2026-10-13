import { describe, expect, it } from 'vitest';
import { createLibraryItem, createProject, placeItem, rectangularRoom } from './factory.js';
import {
  PROJECT_SCHEMA_VERSION,
  libraryItemProblem,
  migrateProject,
  projectProblem,
} from './validate.js';

describe('projectProblem', () => {
  it('accepts what the factories make', () => {
    const project = createProject('Room');
    project.room = rectangularRoom(4000, 3000);
    expect(projectProblem(project)).toBeNull();
  });

  it('names the first thing wrong, with its path', () => {
    const project = createProject('Room');
    project.room = rectangularRoom(4000, 3000);
    project.room.openings.push({
      id: 'o1',
      wallId: 'w_gone',
      offset: 0,
      width: 800,
      kind: 'door',
    });
    expect(projectProblem(project)).toBe(
      'project.room.openings[0].wallId refers to missing wall w_gone',
    );
  });

  it('refuses non-numbers where lengths belong', () => {
    const project = createProject('Room');
    (project.settings as unknown as Record<string, unknown>).gridStep = '25';
    expect(projectProblem(project)).toMatch(/settings\.gridStep must be a finite number/);
  });

  it('refuses things that are not objects at all', () => {
    expect(projectProblem(null)).toMatch(/project must be an object/);
    expect(projectProblem([])).toMatch(/project must be an object/);
  });
});

describe('libraryItemProblem', () => {
  const sofa = () =>
    createLibraryItem({ name: 'Sofa', subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });

  it('accepts what the factory makes', () => {
    expect(libraryItemProblem(sofa())).toBeNull();
  });

  it('refuses a negative depth and a broken footprint', () => {
    expect(libraryItemProblem({ ...sofa(), d: -1 })).toMatch(/item\.d must be at least 0/);
    expect(libraryItemProblem({ ...sofa(), footprint: { kind: 'poly', points: [] } })).toMatch(
      /needs at least 3 points/,
    );
  });
});

describe('migrateProject', () => {
  it('stamps the current version on a file from before versioning', () => {
    const project = createProject('Old');
    delete project.schemaVersion;
    expect(migrateProject(project).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('refuses a file from a newer version instead of guessing', () => {
    const project = { ...createProject('Future'), schemaVersion: PROJECT_SCHEMA_VERSION + 1 };
    expect(() => migrateProject(project)).toThrow(/newer version/);
  });
});

describe('placed items', () => {
  it('accepts a placement made by placeItem', () => {
    const project = createProject('Room');
    project.room = rectangularRoom(4000, 3000);
    const item = createLibraryItem({
      name: 'Chair',
      subcategoryId: 'armchair',
      w: 800,
      d: 800,
      h: 900,
    });
    project.items.push(placeItem(item, 1000, 1000));
    expect(projectProblem(project)).toBeNull();
  });
});
