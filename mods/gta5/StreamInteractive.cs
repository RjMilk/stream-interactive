// Stream Interactive: мост для GTA 5 (ScriptHookVDotNet v3, только сюжетный режим).
// Читает scripts/stream_interactive_commands.txt (его пишет программа Stream Interactive)
// и выполняет команды в игре. Строка: id|команда|аргумент|ник|;
using System;
using System.IO;
using GTA;
using GTA.Math;
using GTA.Native;

public class StreamInteractive : Script
{
    private readonly string file;
    private long lastId = -1;
    private bool primed;   // при первом чтении старые команды пропускаются

    public StreamInteractive()
    {
        file = Path.Combine(BaseDirectory, "stream_interactive_commands.txt");
        Interval = 300;
        Tick += OnTick;
    }

    private void OnTick(object sender, EventArgs e)
    {
        string[] lines;
        try
        {
            if (!File.Exists(file)) { primed = true; return; }
            using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var reader = new StreamReader(fs))
                lines = reader.ReadToEnd().Split('\n');
        }
        catch (IOException) { return; }

        long maxId = lastId;
        foreach (var raw in lines)
        {
            var p = raw.Trim().Split('|');
            long id;
            if (p.Length < 5 || p[4] != ";" || !long.TryParse(p[0], out id) || id <= lastId) continue;
            if (id > maxId) maxId = id;
            if (!primed) continue;
            try { Run(p[1], p[2], p[3]); }
            catch (Exception ex) { GTA.UI.Notification.Show("~r~StreamInteractive: " + ex.Message); }
        }
        lastId = maxId;
        primed = true;
    }

    private static int Int(string s, int fallback)
    {
        int v;
        return int.TryParse(s, out v) ? v : fallback;
    }

    private void Run(string cmd, string arg, string user)
    {
        Ped ped = Game.Player.Character;
        Vector3 ahead = ped.Position + ped.ForwardVector * 8f;

        switch (cmd)
        {
            case "wanted":
                Game.Player.WantedLevel = Math.Max(Game.Player.WantedLevel, Int(arg, 1));
                break;

            case "clearwanted":
                Game.Player.WantedLevel = 0;
                break;

            case "heal":
                ped.Health = ped.MaxHealth;
                ped.Armor = 100;
                break;

            case "money":
                Game.Player.Money += Int(arg, 1000);
                break;

            case "ragdoll":
                Function.Call(Hash.SET_PED_TO_RAGDOLL, ped, 4000, 4000, 0, false, false, false);
                break;

            case "tires":
                if (ped.IsInVehicle())
                    for (int i = 0; i < 8; i++)
                        Function.Call(Hash.SET_VEHICLE_TYRE_BURST, ped.CurrentVehicle, i, true, 1000f);
                break;

            case "explode":
                World.AddExplosion(ahead, ExplosionType.Grenade, 2f, 1f);
                break;

            case "vehicle":
                World.CreateVehicle(new Model(arg), ahead, ped.Heading);
                break;

            case "attackers":
                for (int i = 0; i < Int(arg, 3); i++)
                {
                    Ped enemy = World.CreateRandomPed(ped.Position.Around(18f));
                    if (enemy == null) continue;
                    enemy.Weapons.Give(WeaponHash.Pistol, 200, true, true);
                    enemy.Task.FightAgainst(ped);
                    enemy.MarkAsNoLongerNeeded();
                }
                break;

            case "skyfall":
                ped.Weapons.Give(WeaponHash.Parachute, 1, false, true);
                ped.Position = ped.Position + new Vector3(0f, 0f, 500f);
                break;

            case "disarm":
                ped.Weapons.RemoveAll();
                break;

            // arg: 1 — включить, 0 — выключить
            case "drunk":
                if (arg == "1")
                {
                    Function.Call(Hash.SHAKE_GAMEPLAY_CAM, "DRUNK_SHAKE", 2.5f);
                    Function.Call(Hash.SET_TIMECYCLE_MODIFIER, "spectator5");
                }
                else
                {
                    Function.Call(Hash.STOP_GAMEPLAY_CAM_SHAKING, true);
                    Function.Call(Hash.CLEAR_TIMECYCLE_MODIFIER);
                }
                break;

            // arg: 1 — лунная гравитация, 0 — обычная
            case "gravity":
                Function.Call(Hash.SET_GRAVITY_LEVEL, arg == "1" ? 1 : 0);
                break;

            case "slowmo":
                Game.TimeScale = arg == "1" ? 0.4f : 1f;
                break;

            case "weather":
                World.Weather = (Weather)Enum.Parse(typeof(Weather), arg, true);
                break;

            default:
                GTA.UI.Notification.Show("~r~StreamInteractive: неизвестная команда " + cmd);
                return;
        }
    }
}
