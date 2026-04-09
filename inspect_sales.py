import pandas as pd
import glob
print("Files found:", glob.glob('*.xlsx'))

file = glob.glob('*data*.xlsx')[0]
df = pd.read_excel(file)
print(df.head())
print("Columns:", df.columns.tolist())
