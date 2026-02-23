import express from 'express'
import { projectsRouter } from './routes/projects.js'
import { scrapeRouter } from './routes/scrape.js'
import { placesRouter } from './routes/places.js'
import { shortlistsRouter } from './routes/shortlists.js'

const app = express()
const port = process.env.PORT ?? 3000

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/projects', projectsRouter)
app.use('/api/scrape', scrapeRouter)
app.use('/api/places', placesRouter)
app.use('/api/shortlists', shortlistsRouter)

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})

export { app }
