# 🚀 Video Intelligence Tool

Turn long YouTube videos into **structured knowledge** — summaries, flashcards, quizzes, and insights in seconds.

---

## ✨ Features

- 🎯 AI-powered video summarization  
- 🧠 Flashcards generation for quick revision  
- ❓ Interactive quizzes  
- 📊 Key takeaways extraction  
- ⚡ Handles long videos (chunked processing)  
- 🎨 Modern dark UI with smooth interactions  

---

## 🛠️ Tech Stack

**Frontend**
- HTML, CSS, JavaScript  

**Backend**
- Node.js  
- Express.js  

**AI**
- OpenAI API  

**Deployment**
- Render  

---

## 📦 Project Structure
```bash
video-intelligence-tool/
├── public/
├── server/
├── utils/
├── routes/
├── controllers/
├── .env
├── package.json
```

---

## ⚙️ Setup

### 1. Clone & Install

```bash
git clone https://github.com/ryuupuff/video-intelligence-tool.git
cd video-intelligence-tool
npm install
```

### 2. Create `.env`

```env
OPENAI_API_KEY=your_api_key_here
```

### 3. Run

```bash
node server/index.js
```

Open:  
http://localhost:3000

---

## 🌐 Deployment (Render)

**Build Command**
```bash
npm install
```

**Start Command**
```bash
node server/index.js
```

**Environment Variable**
```env
OPENAI_API_KEY=your_api_key
```

---

## ⚠️ Notes

- Some videos may not have transcripts  
- Fallback uses title + description  
- Long videos are processed in chunks  

---

## 🚀 Future Improvements

- Video thumbnail preview  
- Save history  
- Better quiz logic  
- User accounts  

---

## 👨‍💻 Author

Parth Rathore  

---

## ⭐ Support

If you like this project, give it a star ⭐
