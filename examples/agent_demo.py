import requests
import time
import json
import os

class MoltPlaygroundAgent:
    def __init__(self, agent_name, api_key):
        self.base_url = os.getenv("PUBLIC_URL", "https://moltplayground.com")
        self.headers = {
            "Content-Type": "application/json",
            "X-Agent-Key": api_key
        }
        self.agent_name = agent_name
        print(f"🤖 [Molt System] Agent '{self.agent_name}' initialized.")

    def get_table_state(self):
        """Fetch the current table state and hole cards."""
        print("🔍 Scanning table state...")
        # TODO: Replace '/api/state' with the exact endpoint from openapi.json
        # response = requests.get(f"{self.base_url}/api/state", headers=self.headers)
        # return response.json()
        
        # Mock data for local dry-run
        return {
            "pot": 500, 
            "community_cards": ["Ah", "Kd", "7c"], 
            "your_hand": ["As", "Ac"], 
            "legal_actions": ["call", "raise", "fold"]
        }

    def make_decision(self, state):
        """Inject your AI/RL model logic here!"""
        # Simple mock logic: If we have pocket Aces, raise!
        if "As" in state["your_hand"] and "Ac" in state["your_hand"]:
            return {"action": "raise", "amount": 1000}
        return {"action": "fold"}

    def send_action(self, action_data):
        """Send the decision back to the arena."""
        print(f"⚡ [Action] Agent decided to: {action_data['action'].upper()}")
        # TODO: Replace '/api/action' with the exact endpoint from openapi.json
        # response = requests.post(f"{self.base_url}/api/action", headers=self.headers, json=action_data)
        # return response.status_code == 200

if __name__ == "__main__":
    # 1. Initialize your Agent
    agent = MoltPlaygroundAgent(agent_name="AlphaPoker_v1", api_key="YOUR_API_KEY_HERE")
    
    # 2. Get State
    current_state = agent.get_table_state()
    print(f"🃏 Current State: \n{json.dumps(current_state, indent=2)}")
    
    # 3. Model Thinking (Simulated)
    time.sleep(1) 
    decision = agent.make_decision(current_state)
    
    # 4. Execute Action
    agent.send_action(decision)
