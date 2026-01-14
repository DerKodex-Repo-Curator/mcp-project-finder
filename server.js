#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROJECT_BASE = '/Users/bard/Code';

class ProjectFinderServer {
  constructor() {
    this.server = new Server(
      {
        name: 'mcp-project-finder',
        version: '1.0.0',
        description: 'Fast project discovery and navigation for /Users/bard/Code'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_projects',
          description: 'List all projects in /Users/bard/Code with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                description: 'Optional filter pattern for project names'
              },
              details: {
                type: 'boolean',
                description: 'Include details like last modified date',
                default: false
              }
            }
          }
        },
        {
          name: 'find_project',
          description: 'Find a specific project by name (fuzzy matching supported)',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Project name to search for'
              }
            },
            required: ['name']
          }
        },
        {
          name: 'project_info',
          description: '💡 Architecture Tip: Check project ARCHITECTURE.md or docs/ folder first! Get detailed information about a project.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Project name'
              }
            },
            required: ['name']
          }
        },
        {
          name: 'recent_projects',
          description: 'List recently modified projects',
          inputSchema: {
            type: 'object',
            properties: {
              count: {
                type: 'number',
                description: 'Number of recent projects to return',
                default: 10
              }
            }
          }
        },
        {
          name: 'project_finder_help',
          description: 'Get help on using the project finder tools',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Specific command to get help for (or "all" for overview)'
              }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'list_projects':
          return this.listProjects(args);
        case 'find_project':
          return this.findProject(args);
        case 'project_info':
          return this.projectInfo(args);
        case 'recent_projects':
          return this.recentProjects(args);
        case 'project_finder_help':
          return this.projectFinderHelp(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async projectFinderHelp(args) {
    let helpText = '';
    const command = args?.command;
    
    if (!command || command === 'all') {
      helpText = `📁 Project Finder Help
======================

Fast project discovery and navigation for /Users/bard/Code directory.

Available commands:

📋 list_projects - List all projects with optional filtering
   Optional: filter, details

🔍 find_project - Find specific project by name
   Required: name

ℹ️  project_info - Get detailed project information
   Required: name

🕐 recent_projects - List recently modified projects
   Optional: count

❓ project_finder_help - Show this help
   Optional: command (specific command for details)

Use 'project_finder_help' with a specific command for detailed information.`;
    } else {
      switch (command) {
        case 'list_projects':
          helpText = `📋 list_projects - List all projects

Lists all directories in /Users/bard/Code, excluding hidden folders.

Parameters:
- filter: Filter pattern for project names (optional)
- details: Include modification dates and paths (default: false)

Examples:
// Simple list
list_projects {}

// Filtered list
list_projects { "filter": "mcp" }

// Detailed list with timestamps
list_projects { 
  "filter": "brain",
  "details": true 
}

Returns:
- Simple mode: Newline-separated list of project names
- Details mode: JSON array with name, path, modified, created`;
          break;
          
        case 'find_project':
          helpText = `🔍 find_project - Find specific project

Searches for a project by name with fuzzy matching support.

Parameters:
- name (required): Project name to search for

Examples:
find_project { "name": "brain" }
find_project { "name": "mcp-todo" }

Features:
- Exact match takes priority
- Fuzzy matching for partial names
- Returns up to 5 best matches
- Sorted by match quality

Returns:
- Exact match: Full path to project
- Fuzzy matches: List of matching projects with paths`;
          break;
          
        case 'project_info':
          helpText = `ℹ️  project_info - Get project details

Provides comprehensive information about a specific project.

Parameters:
- name (required): Exact project name

Example:
project_info { "name": "mcp-brain-manager" }

Returns JSON with:
- name: Project name
- path: Full path
- created: Creation date
- modified: Last modification date
- files: Number of files
- directories: Number of subdirectories
- projectType: Detected type (Node.js, Python, etc.)
- projectFiles: List of key files found
- git: Git status info (if applicable)

Project type detection:
- Node.js: Has package.json
- Python: Has requirements.txt
- Rust: Has Cargo.toml
- Go: Has go.mod
- Git: Has .git directory`;
          break;
          
        case 'recent_projects':
          helpText = `🕐 recent_projects - List recent projects

Shows projects sorted by last modification time.

Parameters:
- count: Number of projects to return (default: 10)

Example:
recent_projects { "count": 5 }

Returns JSON array with:
- name: Project name
- path: Full path
- modified: ISO timestamp
- ago: Human-readable time (e.g., "2 hours ago")

Notes:
- Sorted by most recently modified first
- Excludes hidden directories
- Includes relative time for easy scanning`;
          break;
          
        default:
          helpText = `Command '${command}' not found. Use 'project_finder_help' without arguments to see all commands.`;
      }
    }
    
    return {
      content: [
        {
          type: 'text',
          text: helpText
        }
      ]
    };
  }

  async listProjects(args) {
    try {
      const entries = await fs.readdir(PROJECT_BASE, { withFileTypes: true });
      let projects = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
      
      if (args.filter) {
        const filterLower = args.filter.toLowerCase();
        projects = projects.filter(p => p.name.toLowerCase().includes(filterLower));
      }
      
      if (args.details) {
        const projectDetails = await Promise.all(
          projects.map(async (p) => {
            const fullPath = path.join(PROJECT_BASE, p.name);
            const stats = await fs.stat(fullPath);
            return {
              name: p.name,
              path: fullPath,
              modified: stats.mtime.toISOString(),
              created: stats.birthtime.toISOString()
            };
          })
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(projectDetails, null, 2)
            }
          ]
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: projects.map(p => p.name).join('\n')
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing projects: ${error.message}`
          }
        ]
      };
    }
  }

  async findProject(args) {
    try {
      const entries = await fs.readdir(PROJECT_BASE, { withFileTypes: true });
      const projects = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
      
      const searchLower = args.name.toLowerCase();
      
      // Exact match
      const exactMatch = projects.find(p => p.name.toLowerCase() === searchLower);
      if (exactMatch) {
        return {
          content: [
            {
              type: 'text',
              text: `Found exact match: ${path.join(PROJECT_BASE, exactMatch.name)}`
            }
          ]
        };
      }
      
      // Fuzzy matches
      const fuzzyMatches = projects
        .filter(p => p.name.toLowerCase().includes(searchLower))
        .map(p => ({
          name: p.name,
          path: path.join(PROJECT_BASE, p.name),
          score: this.calculateSimilarity(p.name.toLowerCase(), searchLower)
        }))
        .sort((a, b) => b.score - a.score);
      
      if (fuzzyMatches.length > 0) {
        const results = fuzzyMatches.slice(0, 5).map(m => `${m.name} (${m.path})`).join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `Found ${fuzzyMatches.length} matches:\n${results}`
            }
          ]
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `No projects found matching "${args.name}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error finding project: ${error.message}`
          }
        ]
      };
    }
  }

  async projectInfo(args) {
    try {
      const projectPath = path.join(PROJECT_BASE, args.name);
      const stats = await fs.stat(projectPath);
      
      // Check for common project files
      const checkFiles = ['README.md', 'package.json', '.git', 'requirements.txt', 'Cargo.toml'];
      const existingFiles = [];
      
      for (const file of checkFiles) {
        try {
          await fs.access(path.join(projectPath, file));
          existingFiles.push(file);
        } catch (e) {
          // File doesn't exist, skip
        }
      }
      
      // Count files and directories
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      const fileCount = entries.filter(e => e.isFile()).length;
      const dirCount = entries.filter(e => e.isDirectory()).length;
      
      // Get git status if it's a git repo
      let gitInfo = null;
      if (existingFiles.includes('.git')) {
        try {
          const { stdout } = await execAsync('git status --porcelain', { cwd: projectPath });
          const modifiedFiles = stdout.split('\n').filter(line => line.trim()).length;
          gitInfo = { modifiedFiles };
        } catch (e) {
          // Not a git repo or git error
        }
      }
      
      const info = {
        name: args.name,
        path: projectPath,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        size: stats.size,
        files: fileCount,
        directories: dirCount,
        projectType: this.detectProjectType(existingFiles),
        projectFiles: existingFiles,
        ...(gitInfo && { git: gitInfo })
      };
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(info, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting project info: ${error.message}`
          }
        ]
      };
    }
  }

  async recentProjects(args) {
    try {
      const count = args.count || 10;
      const entries = await fs.readdir(PROJECT_BASE, { withFileTypes: true });
      const projects = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
      
      const projectsWithTime = await Promise.all(
        projects.map(async (p) => {
          const fullPath = path.join(PROJECT_BASE, p.name);
          const stats = await fs.stat(fullPath);
          return {
            name: p.name,
            path: fullPath,
            modified: stats.mtime
          };
        })
      );
      
      // Sort by modified time, most recent first
      projectsWithTime.sort((a, b) => b.modified - a.modified);
      
      const recent = projectsWithTime.slice(0, count).map(p => ({
        name: p.name,
        path: p.path,
        modified: p.modified.toISOString(),
        ago: this.timeAgo(p.modified)
      }));
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(recent, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting recent projects: ${error.message}`
          }
        ]
      };
    }
  }

  calculateSimilarity(str1, str2) {
    // Simple similarity score based on position of match
    const index = str1.indexOf(str2);
    if (index === 0) return 1; // Starts with search term
    if (index > 0) return 0.5; // Contains search term
    return 0;
  }

  detectProjectType(files) {
    if (files.includes('package.json')) return 'Node.js';
    if (files.includes('requirements.txt')) return 'Python';
    if (files.includes('Cargo.toml')) return 'Rust';
    if (files.includes('go.mod')) return 'Go';
    if (files.includes('.git')) return 'Git repository';
    return 'Unknown';
  }

  timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    const intervals = {
      year: 31536000,
      month: 2592000,
      week: 604800,
      day: 86400,
      hour: 3600,
      minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
      const interval = Math.floor(seconds / secondsInUnit);
      if (interval >= 1) {
        return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
      }
    }
    
    return 'just now';
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Project Finder MCP server running on stdio');
  }
}

const server = new ProjectFinderServer();
server.run().catch(console.error);
