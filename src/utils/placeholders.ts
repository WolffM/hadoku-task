/**
 * Placeholder examples for task input field
 * Randomly selected on app mount to provide inspiration and variety
 */

const TASK_PLACEHOLDERS = [
  // Everyday tasks
  'Pick up kids after school...',
  'Buy groceries for the week...',
  'Call mom...',
  'Schedule dentist appointment...',
  'Water the plants...',
  'Take out the trash...',
  'Walk the dog...',
  'Do the laundry...',
  'Clean the kitchen...',
  'Pay electric bill...',
  'Reply to emails...',
  'Vacuum the living room...',
  'Change air filters...',
  'Organize closet...',
  'Return library books...',

  // Work/Professional
  'Finish quarterly report...',
  'Review PR #847...',
  'Prepare presentation slides...',
  'Update project documentation...',
  'Schedule team meeting...',
  'Follow up with client...',
  'Review design mockups...',
  'Deploy to production...',
  'Write unit tests...',
  'Refactor authentication module...',
  'Update dependencies...',
  'Fix that annoying bug...',
  'Optimize database queries...',
  "Code review for Sarah's PR...",
  'Update README with new features...',

  // Health & Fitness
  'Go for a 30-minute run...',
  'Meal prep for the week...',
  'Take vitamins...',
  'Stretch for 10 minutes...',
  'Drink 8 glasses of water...',
  'Go to the gym...',
  'Try that new yoga class...',
  'Book physical checkup...',

  // Learning & Development
  'Read one chapter of that book...',
  'Watch TypeScript tutorial...',
  'Practice guitar for 20 minutes...',
  'Complete online course module...',
  'Learn 10 new vocabulary words...',
  'Study for certification exam...',
  'Watch conference talk on React...',
  'Read research paper on AI...',

  // Gaming & Entertainment
  'Beat Elden Ring...',
  'Finish that side quest...',
  'Watch new episode of favorite show...',
  'Catch up on Twitch streams...',
  'Beat that boss fight...',
  '100% completion on Tears of the Kingdom...',
  'Platinum trophy for God of War...',
  "Finally finish Baldur's Gate 3...",
  'Stream that new indie game...',

  // Creative Projects
  'Write blog post about productivity...',
  'Edit vacation photos...',
  'Record podcast episode...',
  'Design new logo concept...',
  'Sketch character ideas...',
  'Compose that song stuck in my head...',
  'Paint the sunset from last week...',
  'Write 500 words of the novel...',

  // Home Projects
  'Fix squeaky door hinge...',
  'Install smart light switches...',
  'Paint the bedroom...',
  'Assemble new bookshelf...',
  'Hang picture frames...',
  'Organize garage...',
  'Plant herb garden...',
  'Repair leaky faucet...',

  // Social & Relationships
  'Text friend about coffee meetup...',
  'Plan date night...',
  'Buy birthday present for Alex...',
  'Write thank you note...',
  'Call grandma...',
  'RSVP to wedding invite...',
  'Organize game night...',
  'Catch up with old college roommate...',

  // Financial
  'Review monthly budget...',
  'File expense reports...',
  'Update investment portfolio...',
  'Cancel unused subscriptions...',
  'Set up auto-pay for utilities...',
  'Check credit score...',
  'Research new credit cards...',

  // Travel & Adventure
  'Book flight for summer vacation...',
  'Research hotels in Tokyo...',
  'Apply for passport renewal...',
  'Create packing list...',
  'Download offline maps...',
  'Learn basic phrases in Spanish...',

  // Tech & Gadgets
  'Back up phone photos to cloud...',
  'Clean up desktop files...',
  'Update all passwords...',
  'Set up two-factor authentication...',
  'Organize browser bookmarks...',
  'Clear out old emails...',
  'Install security updates...',
  'Configure smart home routines...',

  // Random & Funny
  'Become internet famous...',
  'Invent time travel...',
  'Learn to juggle chainsaws...',
  'Train cat to use toilet...',
  'Perfect sourdough starter...',
  'Win argument with internet stranger...',
  "Convince plants I'm a good parent...",
  'Finally understand Git rebase...',
  'Achieve inbox zero (impossible)...',
  'Resist buying another mechanical keyboard...',
  'Stop adding tasks and actually do them...'
] as const

/**
 * Get a random placeholder from the list
 */
export function getRandomPlaceholder(): string {
  return TASK_PLACEHOLDERS[Math.floor(Math.random() * TASK_PLACEHOLDERS.length)]
}
