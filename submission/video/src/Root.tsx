import "./index.css";
import { Composition } from "remotion";
import { HalbaBuildWeek, HalbaThumbnail } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HalbaBuildWeek"
        component={HalbaBuildWeek}
        durationInFrames={2160}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{}}
      />
      <Composition
        id="HalbaThumbnail"
        component={HalbaThumbnail}
        durationInFrames={1}
        fps={30}
        width={1200}
        height={800}
        defaultProps={{}}
      />
    </>
  );
};
