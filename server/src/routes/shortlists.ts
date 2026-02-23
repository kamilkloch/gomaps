import { Router } from 'express'

export const shortlistsRouter = Router()

shortlistsRouter.get('/', (_req, res) => {
  res.json([])
})
