import "./index.css";
import { Composition } from "remotion";
import { HalbaBuildWeek } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HalbaBuildWeek"
      component={HalbaBuildWeek}
      durationInFrames={1740}
      fps={30}
      width={1280}
      height={720}
      defaultProps={{}}
    />
  );
};
