import { Router } from 'express'

export const scrapeRouter = Router()

scrapeRouter.get('/', (_req, res) => {
  res.json([])
})
