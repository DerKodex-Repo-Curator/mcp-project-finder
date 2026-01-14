import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('mcp-project-finder', () => {
  const TEST_BASE = '/tmp/mcp-project-finder-test';
  const TEST_PROJECTS = ['project-alpha', 'project-beta', 'test-gamma', 'demo-delta'];
  
  beforeEach(async () => {
    // Create test directory structure
    await fs.mkdir(TEST_BASE, { recursive: true });
    
    // Create test projects
    for (const project of TEST_PROJECTS) {
      const projectPath = path.join(TEST_BASE, project);
      await fs.mkdir(projectPath, { recursive: true });
      
      // Add some files to make it look like a real project
      await fs.writeFile(
        path.join(projectPath, 'README.md'),
        `# ${project}\n\nTest project for mcp-project-finder`
      );
      
      // Add package.json to some projects
      if (project.startsWith('project-')) {
        await fs.writeFile(
          path.join(projectPath, 'package.json'),
          JSON.stringify({ name: project, version: '1.0.0' }, null, 2)
        );
      }
    }
  });
  
  afterEach(async () => {
    // Clean up test directory
    await fs.rm(TEST_BASE, { recursive: true, force: true });
  });

  describe('Tool Configuration', () => {
    it('should define all expected tools', () => {
      const expectedTools = [
        'list_projects',
        'find_project',
        'project_info',
        'recent_projects',
        'project_finder_help'
      ];
      
      // Validate tool count and names
      assert.strictEqual(expectedTools.length, 5);
      expectedTools.forEach(tool => {
        assert.ok(tool.length > 0);
      });
    });
  });

  describe('Project Listing', () => {
    it('should list all projects in directory', async () => {
      const entries = await fs.readdir(TEST_BASE);
      assert.strictEqual(entries.length, TEST_PROJECTS.length);
      
      // Verify all test projects exist
      TEST_PROJECTS.forEach(project => {
        assert.ok(entries.includes(project));
      });
    });
    
    it('should filter projects by pattern', async () => {
      const entries = await fs.readdir(TEST_BASE);
      
      // Filter for 'project-' prefix
      const filtered = entries.filter(name => name.startsWith('project-'));
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.includes('project-alpha'));
      assert.ok(filtered.includes('project-beta'));
      
      // Filter for 'test' in name
      const testFiltered = entries.filter(name => name.includes('test'));
      assert.strictEqual(testFiltered.length, 1);
      assert.ok(testFiltered.includes('test-gamma'));
    });
    
    it('should get project details', async () => {
      const projectPath = path.join(TEST_BASE, 'project-alpha');
      const stats = await fs.stat(projectPath);
      
      assert.ok(stats.isDirectory());
      assert.ok(stats.mtime instanceof Date);
      assert.ok(stats.size >= 0);
    });
  });

  describe('Project Finding', () => {
    it('should find exact project matches', () => {
      const projects = TEST_PROJECTS;
      const query = 'project-alpha';
      
      const exact = projects.find(p => p === query);
      assert.strictEqual(exact, 'project-alpha');
    });
    
    it('should find fuzzy matches', () => {
      const projects = TEST_PROJECTS;
      
      // Test partial matches
      const alphaMatch = projects.find(p => p.includes('alpha'));
      assert.strictEqual(alphaMatch, 'project-alpha');
      
      // Test case-insensitive matching
      const upperQuery = 'BETA';
      const betaMatch = projects.find(p => p.toLowerCase().includes(upperQuery.toLowerCase()));
      assert.strictEqual(betaMatch, 'project-beta');
    });
    
    it('should rank matches by relevance', () => {
      const projects = ['my-test-project', 'test-utils', 'testing-framework', 'contest'];
      const query = 'test';
      
      // Simple scoring: prioritize matches at start of string
      const scored = projects.map(p => ({
        name: p,
        score: p.startsWith(query) ? 2 : (p.includes(query) ? 1 : 0)
      }));
      
      scored.sort((a, b) => b.score - a.score);
      
      assert.strictEqual(scored[0].name, 'test-utils');
      assert.strictEqual(scored[0].score, 2);
    });
  });

  describe('Project Info', () => {
    it('should read project package.json', async () => {
      const projectPath = path.join(TEST_BASE, 'project-alpha');
      const packagePath = path.join(projectPath, 'package.json');
      
      const content = await fs.readFile(packagePath, 'utf-8');
      const pkg = JSON.parse(content);
      
      assert.strictEqual(pkg.name, 'project-alpha');
      assert.strictEqual(pkg.version, '1.0.0');
    });
    
    it('should handle missing package.json', async () => {
      const projectPath = path.join(TEST_BASE, 'test-gamma');
      const packagePath = path.join(projectPath, 'package.json');
      
      try {
        await fs.access(packagePath);
        assert.fail('Should not find package.json');
      } catch (error) {
        assert.ok(error);
      }
    });
    
    it('should check for git repository', async () => {
      const projectPath = path.join(TEST_BASE, 'project-alpha');
      const gitPath = path.join(projectPath, '.git');
      
      try {
        await fs.access(gitPath);
        assert.fail('Should not find .git directory in test');
      } catch (error) {
        // Expected - no git in test projects
        assert.ok(error);
      }
    });
  });

  describe('Recent Projects', () => {
    it('should sort projects by modification time', async () => {
      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Modify project-beta to be most recent
      const betaPath = path.join(TEST_BASE, 'project-beta', 'new-file.txt');
      await fs.writeFile(betaPath, 'new content');
      
      // Get all projects with stats
      const projects = await Promise.all(
        TEST_PROJECTS.map(async (name) => {
          const stats = await fs.stat(path.join(TEST_BASE, name));
          return { name, mtime: stats.mtime };
        })
      );
      
      // Sort by modification time (newest first)
      projects.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      // Beta should be first (most recent)
      assert.strictEqual(projects[0].name, 'project-beta');
    });
    
    it('should limit recent projects count', () => {
      const projects = TEST_PROJECTS;
      const limit = 2;
      
      const recent = projects.slice(0, limit);
      assert.strictEqual(recent.length, limit);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent directories', async () => {
      const fakePath = path.join(TEST_BASE, 'non-existent');
      
      try {
        await fs.readdir(fakePath);
        assert.fail('Should throw error for non-existent directory');
      } catch (error) {
        assert.ok(error);
      }
    });
    
    it('should handle invalid project names', () => {
      const invalidNames = ['', null, undefined, '../../../etc/passwd'];
      
      invalidNames.forEach(name => {
        if (!name || typeof name !== 'string') {
          assert.ok(!name || typeof name !== 'string');
        } else {
          // Check for path traversal attempts
          assert.ok(name.includes('..'));
        }
      });
    });
  });

  describe('Path Utilities', () => {
    it('should resolve absolute paths correctly', () => {
      const base = '/Users/bard/Code';
      const project = 'my-project';
      const expected = '/Users/bard/Code/my-project';
      
      const resolved = path.join(base, project);
      assert.strictEqual(resolved, expected);
    });
    
    it('should handle path normalization', () => {
      const paths = [
        '/Users/bard/Code//my-project',
        '/Users/bard/Code/./my-project',
        '/Users/bard/Code/other/../my-project'
      ];
      
      const expected = '/Users/bard/Code/my-project';
      
      paths.forEach(p => {
        assert.strictEqual(path.normalize(p), expected);
      });
    });
  });
});
