import pandas as pd
import json
import uuid
import uuid 
import string

try:
    df = pd.read_excel('알트에프 거래처.xlsx')
    # Convert to list of dicts
    records = df.to_dict('records')
    # Give them unique IDs
    formatted = []
    
    for r in records[:5]:
        print(r)
except Exception as e:
    print(e)
