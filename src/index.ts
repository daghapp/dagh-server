import express from 'express'
import http from 'http'  // Add this
import { Server } from 'socket.io'  // Add this
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import dotenv from 'dotenv'
import swaggerUi from 'swagger-ui-express'
import swaggerSpec from './config/swagger'

import authRoutes from './routes/authRoutes'
import visaRoutes from './routes/visaRoutes'
import profileRoutes from './routes/profileRoutes'  // New
import messageRoutes from './routes/messageRoutes'  // New

import { setupSocketHandlers } from './sockets/socketHandlers'  // New

dotenv.config()

const app = express()
const server = http.createServer(app)  // Create HTTP server
const PORT = process.env.PORT || 3000

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST']
  }
})

// Middleware
app.use(helmet())
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}))
app.use(morgan('dev'))
app.use(express.json())

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/visa', visaRoutes)
app.use('/api/profile', profileRoutes)  // New
app.use('/api/messages', messageRoutes)  // New

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

// 404 handler
app.use('/*path', (req, res) => {
  res.status(404).json({ 
    success: false,
    error: `Endpoint '${req.params.path}' not found` 
  })
})

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ 
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  })
})

// Initialize Socket.IO handlers
setupSocketHandlers(io)

// Start server with Socket.IO support
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`)
  console.log(`📚 Swagger docs at http://localhost:${PORT}/api-docs`)
  console.log(`🔌 Socket.IO server ready for connections`)
})
