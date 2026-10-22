import { describe, expect, it } from 'vitest';
import { taskCountLabel, taskListPath } from './tasks-model.js';

describe('tasks model', () => {
  it('uses the authorized task endpoint for each segment', () => {
    expect(taskListPath('available', 2)).toBe('/tasks/available?page=2&pageSize=25');
    expect(taskListPath('mine', 1)).toBe('/tasks?page=1&pageSize=25&mine=true');
    expect(taskListPath('all', 3)).toBe('/tasks?page=3&pageSize=25');
  });

  it('formats pluralized task counts', () => {
    expect(taskCountLabel(undefined)).toBe('Zadaci');
    expect(taskCountLabel({ items: [], page: 1, pageSize: 25, total: 1, totalPages: 1 })).toBe('1 zadatak');
    expect(taskCountLabel({ items: [], page: 1, pageSize: 25, total: 3, totalPages: 1 })).toBe('3 zadatka');
    expect(taskCountLabel({ items: [], page: 1, pageSize: 25, total: 11, totalPages: 1 })).toBe(
      '11 zadataka',
    );
    expect(taskCountLabel({ items: [], page: 1, pageSize: 25, total: 24, totalPages: 1 })).toBe('24 zadatka');
  });
});
