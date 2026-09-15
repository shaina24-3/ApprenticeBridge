def generate_assessment(topic: str):

    return {
        "status": "DRAFT",
        "topic": topic,
        "questions": [
            f"What is an important concept related to {topic}?",
            f"Explain a practical use of {topic}.",
            f"What are common challenges when working with {topic}?"
        ]
    }