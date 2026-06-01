import sqlite3
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

def generate_wait_seconds(dt: datetime, box_id: str | None) -> float:
    # Extrae el tiempo como una fracción decimal de horas
    hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
    
    # Mercadona abierto de 9:00 a 21:30 (21.5)
    if 9.0 <= hour < 21.5:
        base = 40.0 + math.sin(hour * math.pi) * 10.0
        
        morning_peak = 0.0
        if 11.5 <= hour <= 14.0:
            dist = abs(hour - 12.75) / 1.25
            morning_peak = (1.0 - dist * dist) * 130.0
            
        afternoon_peak = 0.0
        if 18.5 <= hour <= 21.0:
            dist = abs(hour - 19.75) / 1.25
            afternoon_peak = (1.0 - dist * dist) * 140.0
            
        # Ondas sinusoidales y ruido aleatorio
        fluctuation = (
            math.sin(hour * 6.0) * 15.0 
            + math.sin(hour * 22.0) * 8.0 
            + (random.random() - 0.5) * 12.0
        )
        
        # Modificadores de caja para aportar diversidad
        if box_id == '1':
            wait_seconds = (base + morning_peak + afternoon_peak + fluctuation) * 1.1 + 5.0
        elif box_id == '2':
            wait_seconds = (base + morning_peak + afternoon_peak + fluctuation) * 0.95 - 5.0
        elif box_id == '3':
            wait_seconds = (base + morning_peak + afternoon_peak + fluctuation) * 0.8 - 15.0
        elif box_id == '4':
            wait_seconds = (base + morning_peak + afternoon_peak + fluctuation) * 1.05 + 2.0
        elif box_id == '5':
            wait_seconds = (base + morning_peak + afternoon_peak + fluctuation) * 0.9 - 8.0
        elif box_id == '6':
            wait_seconds = (base + morning_peak + afternoon_peak + fluctuation) * 0.75 - 20.0
        else:
            # Global
            wait_seconds = base + morning_peak + afternoon_peak + fluctuation
            
        # Acotación: estrictamente inferior a 3.5 minutos (210s) y siempre positivo
        min_wait = 10.0 if box_id is None else 5.0
        wait_seconds = max(min_wait, min(209.0, wait_seconds))
    else:
        # Horario de cierre: valores de espera casi nulos
        wait_seconds = max(0.0, (random.random() - 0.5) * 2.0)
        
    return wait_seconds

def main():
    print("[SEMILLERO] Iniciando sembrado de 1 año de datos...")
    
    # Ruta física a la base de datos SQLite
    db_path = Path(__file__).resolve().parent / "msq.db"
    if not db_path.exists():
        print(f"[ERROR] No se encuentra la base de datos en: {db_path}")
        return
        
    print(f"[SEMILLERO] Conectando a {db_path}...")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Limpieza de tablas
    print("[SEMILLERO] Vaciando tablas 'metricas' e 'instantaneas'...")
    cursor.execute("DELETE FROM metricas")
    cursor.execute("DELETE FROM instantaneas")
    try:
        cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('metricas', 'instantaneas')")
    except sqlite3.OperationalError:
        pass  # Si la secuencia no existe, ignorar
    conn.commit()
    
    # Asegurar la existencia de las 6 cajas físicas en la tabla
    print("[SEMILLERO] Asegurando que existen las 6 cajas en la tabla 'cajas'...")
    cajas_existentes = ['1', '2', '3', '4', '5', '6']
    now_iso = datetime.now(timezone.utc).isoformat()
    for caja_id in cajas_existentes:
        cursor.execute("INSERT OR IGNORE INTO cajas (id, estado, actualizado_en) VALUES (?, ?, ?)", (caja_id, 'cerrada', now_iso))
    conn.commit()
    
    # Segmentos de sembrado
    segments = [None, '1', '2', '3', '4', '5', '6']
    
    now = datetime.now(timezone.utc)
    records = []
    
    # Sembrado con densidad progresiva
    print("[SEMILLERO] Generando datos progresivos...")
    
    for segment in segments:
        segment_name = "Global" if segment is None else f"Caja {segment}"
        print(f"[SEMILLERO] Generando puntos para {segment_name}...")
        
        # Periodo 1: Últimas 24 horas (intervalos de 20 minutos)
        start_ms = now - timedelta(days=1)
        current = start_ms
        while current <= now:
            wait_s = generate_wait_seconds(current, segment)
            records.append((current.isoformat(), segment, wait_s, 'simulador_historico'))
            current += timedelta(minutes=20)
            
        # Periodo 2: Días -7 a -1 (intervalos de 1.5 horas)
        start_ms = now - timedelta(days=7)
        end_ms = now - timedelta(days=1)
        current = start_ms
        while current < end_ms:
            wait_s = generate_wait_seconds(current, segment)
            records.append((current.isoformat(), segment, wait_s, 'simulador_historico'))
            current += timedelta(hours=1, minutes=30)
            
        # Periodo 3: Días -30 a -7 (intervalos de 3 horas)
        start_ms = now - timedelta(days=30)
        end_ms = now - timedelta(days=7)
        current = start_ms
        while current < end_ms:
            wait_s = generate_wait_seconds(current, segment)
            records.append((current.isoformat(), segment, wait_s, 'simulador_historico'))
            current += timedelta(hours=3)
            
        # Periodo 4: Días -365 a -30 (intervalos de 10 horas)
        start_ms = now - timedelta(days=365)
        end_ms = now - timedelta(days=30)
        current = start_ms
        while current < end_ms:
            wait_s = generate_wait_seconds(current, segment)
            records.append((current.isoformat(), segment, wait_s, 'simulador_historico'))
            current += timedelta(hours=10)
            
    # Ordenar cronológicamente antes de insertar para alinear el ID con la fecha
    print("[SEMILLERO] Ordenando registros cronológicamente...")
    records.sort(key=lambda r: r[0])

    print(f"[SEMILLERO] Insertando {len(records)} registros en base de datos...")
    
    # Inserción masiva eficiente
    cursor.executemany(
        """
        INSERT INTO metricas (registrada_en, id_caja, tiempo_medio_espera_segundos, fuente)
        VALUES (?, ?, ?, ?)
        """,
        records
    )
    conn.commit()
    conn.close()
    
    print("[SEMILLERO] ¡Sembrado completado con éxito!")

if __name__ == "__main__":
    main()
