import { z } from 'zod'

export const sendMessageSchema = z.object({
  body: z.object({
    receiverId: z.string().uuid('Invalid receiver ID'),
    content: z.string().min(1, 'Message cannot be empty').max(2000, 'Message too long')
  })
})

export const messageIdSchema = z.object({
  params: z.object({
    messageId: z.string().uuid('Invalid message ID')
  })
})

export type SendMessageSchema = z.infer<typeof sendMessageSchema>
export type MessageIdSchema = z.infer<typeof messageIdSchema>