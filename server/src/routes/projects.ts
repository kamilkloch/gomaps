import { Router } from 'express'
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from '../db/index.js'

export const projectsRouter = Router()

projectsRouter.get('/', (_req, res) => {
  const projects = listProjects()
  res.json(projects)
})

projectsRouter.post('/', (req, res) => {
  const { name, bounds } = req.body as { name?: string; bounds?: string }
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const project = createProject(name, bounds)
  res.status(201).json(project)
})

projectsRouter.get('/:id', (req, res) => {
  const project = getProject(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  res.json(project)
})

projectsRouter.put('/:id', (req, res) => {
  const { name, bounds } = req.body as { name?: string; bounds?: string }
  const project = updateProject(req.params.id, { name, bounds })
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  res.json(project)
})

projectsRouter.delete('/:id', (req, res) => {
  const deleted = deleteProject(req.params.id)
  if (!deleted) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  res.status(204).end()
})
