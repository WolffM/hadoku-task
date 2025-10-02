// Simple test server to mock the API responses
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

// Mock data for different user types
const mockData = {
  public: {
    tasks: [
      { id: 'pub1', title: 'Public Task 1', tag: 'public', createdAt: new Date().toISOString() },
      { id: 'pub2', title: 'Public Task 2', tag: 'info', createdAt: new Date().toISOString() }
    ]
  },
  friend: {
    tasks: [
      { id: 'friend1', title: 'Friend Task 1', tag: 'friend', createdAt: new Date().toISOString() },
      { id: 'friend2', title: 'Friend Task 2', tag: 'work', createdAt: new Date().toISOString() }
    ]
  },
  admin: {
    tasks: [
      { id: 'admin1', title: 'Admin Task 1', tag: 'admin', createdAt: new Date().toISOString() },
      { id: 'admin2', title: 'Admin Task 2', tag: 'system', createdAt: new Date().toISOString() },
      { id: 'admin3', title: 'Secret Admin Task', tag: 'secret', createdAt: new Date().toISOString() }
    ]
  }
}

app.get('/api/task', (req, res) => {
  const userType = req.query.userType || 'public'
  const data = mockData[userType] || mockData.public
  
  res.json({
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks: data.tasks
  })
})

app.post('/api/task', (req, res) => {
  const userType = req.headers['x-user-type'] || 'public'
  if (userType === 'public') {
    return res.status(403).json({ error: 'Public users cannot create tasks' })
  }
  
  const newTask = {
    id: Date.now().toString(),
    title: req.body.title,
    tag: req.body.tag,
    createdAt: new Date().toISOString()
  }
  
  mockData[userType].tasks.unshift(newTask)
  res.json({ ok: true, id: newTask.id })
})

app.listen(3001, () => {
  console.log('Mock API server running on http://localhost:3001')
})